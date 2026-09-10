"""Run a local QA expression against the debug APK's forwarded WebView CDP port.

Usage inside the emulator container: python3 /src/scripts/android-cdp.py expression.js
Requires `adb forward tcp:9222 localabstract:webview_devtools_remote_<app pid>`.
The port is container-local; never expose a debug WebView port on the public server.
"""
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import urllib.request
from urllib.parse import urlsplit


class CDP:
    def __init__(self):
        pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10))
        page = next(p for p in pages if p.get("type") == "page" and "127.0.0.1" in p.get("url", ""))
        url = urlsplit(page["webSocketDebuggerUrl"])
        self.sock = socket.create_connection((url.hostname, url.port), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {url.path} HTTP/1.1\r\nHost: {url.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        header = b""
        while not header.endswith(b"\r\n\r\n"):
            header += self.read(1)
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        if b" 101 " not in header or accept not in header:
            raise RuntimeError("WebView debug connection rejected")
        self.sequence = 0

    def read(self, count):
        data = b""
        while len(data) < count:
            chunk = self.sock.recv(count-len(data))
            if not chunk:
                raise RuntimeError("WebView disconnected")
            data += chunk
        return data

    def send(self, data, opcode=1):
        mask = os.urandom(4)
        n = len(data)
        prefix = bytes([0x80 | opcode])
        prefix += bytes([0x80 | n]) if n < 126 else bytes([0xfe]) + struct.pack("!H", n) if n < 65536 else bytes([0xff]) + struct.pack("!Q", n)
        self.sock.sendall(prefix + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def receive(self):
        data = b""
        while True:
            first, second = self.read(2)
            n = second & 127
            if n == 126:
                n = struct.unpack("!H", self.read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self.read(8))[0]
            if n > 16*1024*1024:
                raise RuntimeError("Unexpected debug frame size")
            mask = self.read(4) if second & 128 else None
            chunk = self.read(n)
            if mask:
                chunk = bytes(b ^ mask[i % 4] for i, b in enumerate(chunk))
            opcode = first & 15
            if opcode == 8:
                raise RuntimeError("WebView closed debug connection")
            if opcode == 9:
                self.send(chunk, 10)
                continue
            if opcode in (0, 1):
                data += chunk
                if first & 128:
                    return json.loads(data)

    def evaluate(self, expression):
        self.sequence += 1
        self.send(json.dumps({"id":self.sequence,"method":"Runtime.evaluate","params":{"expression":expression,"awaitPromise":True,"returnByValue":True}}).encode())
        while True:
            reply = self.receive()
            if reply.get("id") == self.sequence:
                if "error" in reply or "exceptionDetails" in reply.get("result", {}):
                    raise RuntimeError(json.dumps(reply, ensure_ascii=False))
                return reply["result"]["result"].get("value")


if __name__ == "__main__":
    expression = open(sys.argv[1], encoding="utf-8-sig").read() if len(sys.argv) > 1 else "({title:document.title,ready:!!document.querySelector('#auth-form'),width:innerWidth,height:innerHeight})"
    cdp = CDP()
    try:
        print(json.dumps(cdp.evaluate(expression), ensure_ascii=False))
    finally:
        cdp.sock.close()
