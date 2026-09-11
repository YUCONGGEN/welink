//go:build windows

package main

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	webview "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows/registry"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"welink/internal/nativeinit"
)

//go:embed payload/WeLink-Windows.exe payload/icon.svg
var files embed.FS
var u32 = syscall.NewLazyDLL("user32.dll")

func main() {
	silent := flag.Bool("silent", false, "install without opening the installer UI")
	directory := flag.String("dir", "", "installation directory")
	flag.Parse()
	if *directory == "" {
		*directory = filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "WeLink")
	}
	if *silent {
		if err := install(*directory); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	runtime.LockOSThread()
	if err := nativeinit.Prepare(filepath.Join(os.Getenv("LOCALAPPDATA"), "WeLink", "setup")); err != nil {
		return
	}
	v := webview.NewWithOptions(webview.WebViewOptions{AutoFocus: true, WindowOptions: webview.WindowOptions{Title: "安装 WeLink", Width: 1008, Height: 650, Center: true}})
	if v == nil {
		return
	}
	defer v.Destroy()
	v.SetSize(1008, 650, webview.HintFixed)
	hwnd := uintptr(v.Window())
	index := int32(-16)
	style, _, _ := u32.NewProc("GetWindowLongW").Call(hwnd, uintptr(index))
	u32.NewProc("SetWindowLongW").Call(hwnd, uintptr(index), style&^uintptr(0x00c00000))
	u32.NewProc("SetWindowPos").Call(hwnd, 0, 0, 0, 0, 0, 0x0027)
	v.Bind("closeSetup", func() { v.Terminate() })
	v.Bind("minimizeSetup", func() { u32.NewProc("ShowWindow").Call(hwnd, 6) })
	v.Bind("dragSetup", func() { u32.NewProc("ReleaseCapture").Call(); u32.NewProc("SendMessageW").Call(hwnd, 0xA1, 2, 0) })
	v.Bind("installWeLink", func(dir string) (string, error) {
		if err := install(dir); err != nil {
			return "", err
		}
		return filepath.Join(dir, "WeLink-Windows.exe"), nil
	})
	v.Bind("launchWeLink", func(path string) error {
		if filepath.Base(path) != "WeLink-Windows.exe" {
			return errors.New("无效的程序路径")
		}
		cmd := exec.Command(path)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := cmd.Start(); err != nil {
			return err
		}
		v.Terminate()
		return nil
	})
	icon, _ := files.ReadFile("payload/icon.svg")
	pathJSON, _ := json.Marshal(*directory)
	page := strings.ReplaceAll(setupHTML, "{{ICON}}", base64.StdEncoding.EncodeToString(icon))
	page = strings.ReplaceAll(page, "{{DIRECTORY}}", string(pathJSON))
	v.SetHtml(page)
	v.Run()
}
func install(directory string) error {
	dir, err := filepath.Abs(directory)
	if err != nil || !filepath.IsAbs(directory) || len(dir) < 5 {
		return errors.New("请选择有效的安装目录")
	}
	if err = os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("无法创建安装目录：%w", err)
	}
	payload, err := files.ReadFile("payload/WeLink-Windows.exe")
	if err != nil {
		return err
	}
	target := filepath.Join(dir, "WeLink-Windows.exe")
	tmp := target + ".new"
	if err = os.WriteFile(tmp, payload, 0755); err != nil {
		return err
	}
	if err = os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return errors.New("无法更新程序，请先退出正在运行的 WeLink 后重试")
	}
	programs := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs")
	if err = os.MkdirAll(programs, 0755); err != nil {
		return err
	}
	shortcut := filepath.Join(programs, "WeLink.lnk")
	desktop := filepath.Join(os.Getenv("USERPROFILE"), "Desktop", "WeLink.lnk")
	script := `$ErrorActionPreference='Stop'; $w=New-Object -ComObject WScript.Shell; foreach($name in @($env:WELINK_START_LINK,$env:WELINK_DESKTOP_LINK)) { $s=$w.CreateShortcut($name); $s.TargetPath=$env:WELINK_INSTALLED_EXE; $s.WorkingDirectory=$env:WELINK_INSTALLED_DIR; $s.Description='WeLink'; $s.Save() }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "WELINK_START_LINK="+shortcut, "WELINK_DESKTOP_LINK="+desktop, "WELINK_INSTALLED_EXE="+target, "WELINK_INSTALLED_DIR="+dir)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err = cmd.Run(); err != nil {
		return errors.New("程序已安装，但创建快捷方式失败")
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Uninstall\WeLink`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	uninstallPath := filepath.Join(dir, "Uninstall.ps1")
	if err = os.WriteFile(uninstallPath, []byte("\xef\xbb\xbf"+uninstallScript), 0600); err != nil {
		return err
	}
	for k, v := range map[string]string{"DisplayName": "WeLink", "DisplayVersion": "0.1.9", "Publisher": "WeLink", "InstallLocation": dir, "DisplayIcon": target, "UninstallString": `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "` + uninstallPath + `"`} {
		if err = key.SetStringValue(k, v); err != nil {
			return err
		}
	}
	protocol, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\welink`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer protocol.Close()
	if err = protocol.SetStringValue("", "URL:WeLink meeting"); err != nil {
		return err
	}
	if err = protocol.SetStringValue("URL Protocol", ""); err != nil {
		return err
	}
	command, _, err := registry.CreateKey(protocol, `shell\open\command`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer command.Close()
	if err = command.SetStringValue("", `"`+target+`" -- "%1"`); err != nil {
		return err
	}
	key.SetDWordValue("NoModify", 1)
	key.SetDWordValue("NoRepair", 1)
	return nil
}

// Remove only files installed by WeLink. Unknown files and user chat data remain.
const uninstallScript = `Add-Type -AssemblyName System.Windows.Forms
$answer=[System.Windows.Forms.MessageBox]::Show('卸载 WeLink？个人资料和聊天缓存将保留。','WeLink 卸载','YesNo','Question')
if($answer -ne 'Yes'){exit}
$installDirectory=[IO.Path]::GetFullPath($PSScriptRoot)
$registered=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WeLink' -ErrorAction Stop).InstallLocation
if([IO.Path]::GetFullPath($registered) -ne $installDirectory){throw '安装目录不匹配'}
$targetExecutable=Join-Path $installDirectory 'WeLink-Windows.exe'
if(Get-Process -Name 'WeLink-Windows' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $targetExecutable}){[void][System.Windows.Forms.MessageBox]::Show('请先退出 WeLink，再运行卸载程序。','WeLink');exit}
Remove-Item -LiteralPath $targetExecutable -ErrorAction Stop
$startupPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupKey=Get-Item -LiteralPath $startupPath -ErrorAction SilentlyContinue
if($startupKey){foreach($entry in $startupKey.GetValueNames()){$command=$startupKey.GetValue($entry);if($entry -like 'WeLink-*' -and $command -is [string] -and $command.StartsWith(('"'+$targetExecutable+'" '),[StringComparison]::OrdinalIgnoreCase)){Remove-ItemProperty -LiteralPath $startupPath -Name $entry}}}
$startLink=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\WeLink.lnk'
$desktopLink=Join-Path ([Environment]::GetFolderPath('Desktop')) 'WeLink.lnk'
$shell=New-Object -ComObject WScript.Shell
foreach($link in @($startLink,$desktopLink)){if((Test-Path -LiteralPath $link) -and $shell.CreateShortcut($link).TargetPath -eq $targetExecutable){Remove-Item -LiteralPath $link}}
$protocolKey=Get-Item -LiteralPath 'HKCU:\Software\Classes\welink\shell\open\command' -ErrorAction SilentlyContinue
if($protocolKey -and $protocolKey.GetValue('') -eq ('"'+$targetExecutable+'" -- "%1"')){Remove-Item -LiteralPath 'HKCU:\Software\Classes\welink' -Recurse}
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WeLink'
Remove-Item -LiteralPath $PSCommandPath
if(@(Get-ChildItem -LiteralPath $installDirectory -Force).Count -eq 0){Remove-Item -LiteralPath $installDirectory}
[void][System.Windows.Forms.MessageBox]::Show('WeLink 已卸载。','WeLink')
`

const setupHTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden;font:17px 'Microsoft YaHei',sans-serif;color:#8e99a8}body{background:radial-gradient(at 10% 10%,#fff0f2,transparent 55%),radial-gradient(at 90% 20%,#e4f8fe,transparent 70%),linear-gradient(#eef4ff,#f2fcfe 60%,white)}header{height:38px;display:flex;justify-content:flex-end}header button{height:32px;width:48px;border:0;background:none;color:#28323e;font-size:23px}header button:hover{background:#e6eef5}header button:last-child:hover{background:#ef5959;color:#fff}.brand{position:absolute;top:34%;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:20px;color:#101b2e}.brand img{width:88px;height:88px}.brand b{font-size:68px;letter-spacing:-3px;font-weight:600}#install{position:absolute;top:66%;left:50%;transform:translateX(-50%);background:#0099ff;color:white;border:0;border-radius:5px;font-size:23px;padding:9px 29px;cursor:pointer}#install:hover{background:#008eec}#install:disabled{opacity:.65;cursor:wait}.bottom{position:absolute;bottom:29px;left:34px;right:34px;display:flex;align-items:center;gap:9px;font-size:15px}.bottom input{accent-color:#0099ff;width:18px;height:18px}.bottom a{color:#0099ff;cursor:pointer}.bottom button{margin-left:auto;background:none;border:0;color:#8e99a8;font-size:15px;cursor:pointer}#custom{position:absolute;bottom:75px;left:45px;right:45px;display:none;font-size:13px}#custom input{width:100%;border:1px solid #d9e5ee;background:#fffd;padding:9px;border-radius:5px;margin-top:8px;color:#536376}#status{position:absolute;top:77%;left:35px;right:35px;font-size:13px;text-align:center;color:#ea6666}</style><header onpointerdown="if(event.target===this)dragSetup()"><button onclick="minimizeSetup()">−</button><button onclick="closeSetup()">×</button></header><div class="brand"><img src="data:image/svg+xml;base64,{{ICON}}"><b>WeLink</b></div><button id="install">立即安装</button><div id="status"></div><div id="custom">安装目录<input id="directory"></div><div class="bottom"><input id="agree" type="checkbox" checked><span>我已阅读 <a onclick="document.getElementById('status').textContent='WeLink 使用独立账号；远程协助必须经过双方同意。应用数据保存在个人目录及服务端。'">使用说明与隐私说明</a></span><button onclick="document.getElementById('custom').style.display=document.getElementById('custom').style.display==='block'?'none':'block'">⌄ 自定义选项</button></div><script>document.getElementById('directory').value={{DIRECTORY}};let executable='';document.getElementById('install').onclick=async function(){if(!document.getElementById('agree').checked){document.getElementById('status').textContent='请先阅读并同意使用说明';return}this.disabled=true;try{if(executable){await launchWeLink(executable);return}this.textContent='正在安装…';executable=await installWeLink(document.getElementById('directory').value);this.textContent='立即体验';document.getElementById('status').textContent='安装完成，已创建桌面和开始菜单快捷方式。';document.getElementById('status').style.color='#7a91a4'}catch(error){this.textContent='重新安装';document.getElementById('status').textContent=String(error)}finally{this.disabled=false}}</script></html>`
