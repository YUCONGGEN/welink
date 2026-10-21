(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // internal/ui/src/me-ai.js
  function createMe({ S: S2, api: api2, action: action2, esc: esc2, icon: icon2, modal: modal2, closeModal: closeModal2, toast: toast2, refresh: refresh2, selectConversation: selectConversation2, renderSidebar: renderSidebar2 }) {
    const $2 = (s) => document.querySelector(s), localDesktop = () => ["windows", "darwin"].includes(S2.config.platform);
    let config = null, local = { workspace: "", available: false }, generation = 0, timer, task = null, seen = /* @__PURE__ */ new Set(), starting = false;
    const active = () => S2.conversations.find((c) => c.id === S2.active), live = (g) => g === generation && S2.user && !S2.signingOut;
    async function start() {
      stop();
      const g = generation;
      try {
        const value = await api2("/api/ai/config");
        if (!live(g)) return;
        config = value;
        if (!value.enabled) return;
        if (localDesktop()) {
          try {
            const prefs = await api2("/local/ai/config");
            if (live(g)) local = prefs;
          } catch (e) {
          }
        }
        if (live(g)) {
          renderSidebar2();
          poll();
        }
      } catch (e) {
      }
    }
    function stop() {
      var _a;
      generation++;
      clearTimeout(timer);
      task = null;
      config = null;
      local = { workspace: "", available: false };
      seen.clear();
      starting = false;
      (_a = $2("#me-panel")) == null ? void 0 : _a.remove();
    }
    function sidebar() {
      return (config == null ? void 0 : config.enabled) && !S2.conversations.some((c) => {
        var _a;
        return ((_a = c.peer) == null ? void 0 : _a.id) === config.user.id;
      }) ? '<button class="conversation-row me-entry" data-me-open><span class="me-avatar">M</span><div class="row-text"><b>Me <em class="ai-label">AI</em></b><div class="row-preview">你的 AI 助手</div></div></button>' : "";
    }
    function render() {
      var _a, _b;
      const panel = $2("#me-panel");
      if (!panel || !((_b = (_a = active()) == null ? void 0 : _a.peer) == null ? void 0 : _b.ai)) return;
      panel.classList.remove("hidden");
      if (!panel.querySelector(".me-config")) panel.innerHTML = '<div class="me-config"><span class="ai-label">AI</span><span data-me-workspace></span><button class="text-btn" data-me-workspace-button>工作目录</button></div><div class="me-progress" role="status"><span data-me-status></span><button class="text-btn hidden" data-me-cancel>停止</button></div><div class="me-approvals"></div>';
      panel.querySelector("[data-me-workspace]").textContent = localDesktop() ? local.workspace ? "本机：" + local.workspace : "对话模式 · 选择目录后可处理本机任务" : "记住本会话上下文 · 本机任务请在桌面端执行";
      panel.querySelector("[data-me-workspace-button]").classList.toggle("hidden", !localDesktop());
      const current = (task == null ? void 0 : task.conversationId) === S2.active ? task : null, busy = starting || (current == null ? void 0 : current.state) === "running";
      panel.querySelector("[data-me-status]").textContent = starting ? "正在交给 Me…" : (current == null ? void 0 : current.error) || ((current == null ? void 0 : current.state) === "running" ? "Me 正在处理…" : (current == null ? void 0 : current.state) === "completed" ? "已完成" : (current == null ? void 0 : current.state) === "cancelled" ? "已停止" : "");
      panel.querySelector("[data-me-cancel]").classList.toggle("hidden", !current || !busy);
      const area = $2("#messages"), near = area && area.scrollHeight - area.clientHeight - area.scrollTop < 100;
      let stream = $2("#me-stream");
      if ((current == null ? void 0 : current.state) === "running" && current.text && area) {
        if (!stream) {
          stream = document.createElement("article");
          stream.id = "me-stream";
          stream.className = "message me-stream";
          stream.innerHTML = '<span class="avatar me-avatar">M</span><div class="message-body"><span class="message-name">Me · AI</span><div class="bubble"></div></div>';
          area.append(stream);
        }
        stream.querySelector(".bubble").textContent = current.text;
        if (near) area.scrollTop = area.scrollHeight;
      } else stream == null ? void 0 : stream.remove();
      const approvals = panel.querySelector(".me-approvals"), pending = ((current == null ? void 0 : current.events) || []).filter((e) => e.type === "approval");
      for (const node of approvals.children) if (!pending.some((e) => e.id === node.dataset.approvalId)) node.remove();
      for (const e of pending) {
        if ([...approvals.children].some((n) => n.dataset.approvalId === e.id)) continue;
        const d = e.details || {}, node = document.createElement("section");
        node.className = "me-approval";
        node.dataset.approvalId = e.id;
        const question = e.method === "item/tool/requestUserInput";
        node.innerHTML = "<b>" + esc2(question ? "Me 需要补充信息" : "Me 请求执行操作") + "</b><p>" + esc2(d.reason || "请查看以下内容后决定") + "</p>" + (question ? (d.questions || []).map((q) => "<label>" + esc2(q.question || q.header) + '<textarea data-me-answer="' + esc2(q.id) + '" maxlength="4000" placeholder="' + esc2((q.options || []).map((o) => o.label).join(" / ")) + '"></textarea></label>').join("") : "<pre>" + esc2(d.command || JSON.stringify(d.item || d.permissions || d, null, 2)).slice(0, 8e3) + "</pre>") + '<div><button class="primary" data-me-approve>' + (question ? "提交回答" : "允许这一次") + '</button><button class="secondary" data-me-deny>拒绝</button></div>';
        approvals.append(node);
      }
    }
    async function poll() {
      const g = generation;
      if (!(config == null ? void 0 : config.enabled) || !live(g)) return;
      try {
        if ((task == null ? void 0 : task.mode) === "chat") {
          const result = await api2("/api/ai/runs/" + task.id);
          if (live(g)) {
            const text = task.text, version = task.version;
            Object.assign(task, result);
            if (version > (result.version || 0) && task.state === "running") {
              task.text = text;
              task.version = version;
            }
          }
        } else if (localDesktop()) {
          const result = await api2("/local/ai/status");
          if (live(g) && result.id) task = __spreadProps(__spreadValues({}, result), { mode: "local" });
        }
        if (live(g)) render();
      } catch (e) {
      } finally {
        if (live(g)) timer = setTimeout(poll, (task == null ? void 0 : task.state) === "running" ? 700 : 3e3);
      }
    }
    async function onSent(message) {
      var _a, _b;
      if (!(config == null ? void 0 : config.enabled) || message.sender !== ((_a = S2.user) == null ? void 0 : _a.id) || seen.has(message.id)) return;
      const c = S2.conversations.find((c2) => c2.id === message.conversationId);
      if (!((_b = c == null ? void 0 : c.peer) == null ? void 0 : _b.ai)) return;
      seen.add(message.id);
      if (seen.size > 200) seen.delete(seen.values().next().value);
      const g = generation;
      starting = true;
      render();
      try {
        let result;
        if (localDesktop() && local.workspace) {
          if (!local.available) throw Error("本机未检测到 Codex CLI，请先安装 Codex CLI；普通对话仍可使用。");
          result = await action2("/local/ai/start", { messageId: message.id });
          if (live(g)) task = __spreadProps(__spreadValues({}, result), { state: "running", mode: "local" });
        } else {
          result = await action2("/api/ai/runs", { messageId: message.id, mode: "chat" });
          if (live(g)) task = __spreadProps(__spreadValues({}, (task == null ? void 0 : task.id) === result.id ? task : {}), { id: result.id, conversationId: result.conversationId, state: "running", mode: "chat" });
        }
      } catch (error) {
        if (live(g)) {
          task = { conversationId: message.conversationId, state: "failed", error: error.message };
          toast2(error.message);
        }
      } finally {
        if (live(g)) {
          starting = false;
          render();
          clearTimeout(timer);
          poll();
        }
      }
    }
    async function workspace() {
      if (!local.available) {
        toast2("本机未检测到 Codex CLI，请先安装 Codex CLI；普通对话仍可使用。");
        return;
      }
      modal2("Me 的本地工作目录", '<p class="hint">Me 可以在此目录内读写文件和运行任务。需要额外权限时，会在聊天中向你确认。</p><label>工作目录<input id="me-workspace" placeholder="例如 E:\\工作文件" value="' + esc2(local.workspace) + '"></label><p class="hint">清空目录后恢复为对话模式。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="me-save-workspace">保存</button>');
      $2("#me-save-workspace").onclick = async () => {
        try {
          const value = await action2("/local/ai/config", { workspace: $2("#me-workspace").value.trim() });
          local.workspace = value.workspace;
          closeModal2();
          render();
        } catch (error) {
          toast2(error.message);
        }
      };
    }
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-me-open],[data-me-workspace-button],[data-me-cancel],[data-me-approve],[data-me-deny]");
      if (!b) return;
      try {
        if (b.hasAttribute("data-me-open")) {
          if (!(config == null ? void 0 : config.user)) return;
          const c = await action2("/api/conversations", { kind: "direct", members: [config.user.id] });
          await refresh2();
          await selectConversation2(c.id);
        } else if (b.hasAttribute("data-me-workspace-button")) await workspace();
        else if (b.hasAttribute("data-me-cancel") && task) {
          await action2(task.mode === "local" ? "/local/ai/cancel" : "/api/ai/runs/" + task.id + "/cancel");
          task.state = "cancelled";
          render();
        } else {
          const node = b.closest(".me-approval");
          if (!node || !task) return;
          const answers = {};
          for (const input of node.querySelectorAll("[data-me-answer]")) answers[input.dataset.meAnswer] = { answers: [input.value] };
          b.disabled = true;
          await action2("/local/ai/approve", { taskId: task.id, id: node.dataset.approvalId, accept: b.hasAttribute("data-me-approve"), answers });
          node.remove();
        }
      } catch (error) {
        toast2(error.message);
        b.disabled = false;
      }
    });
    function changed(type, d) {
      if (!(config == null ? void 0 : config.enabled) || !S2.conversations.some((c) => {
        var _a;
        return c.id === d.conversationId && ((_a = c.peer) == null ? void 0 : _a.ai);
      })) return;
      if ((task == null ? void 0 : task.id) !== d.id) task = { id: d.id, conversationId: d.conversationId, state: "running", mode: "chat", text: "", version: 0 };
      if (type === "ai-delta") {
        if (d.version <= (task.version || 0)) return;
        task.text = (task.text || "") + d.delta;
        task.version = d.version;
      } else {
        task.state = d.state;
        task.error = d.error;
      }
      render();
    }
    return { changed, start, stop, sidebar, mount: render, onSent, busy: () => {
      var _a, _b;
      return ((_b = (_a = active()) == null ? void 0 : _a.peer) == null ? void 0 : _b.ai) && (starting || (task == null ? void 0 : task.state) === "running" && (task == null ? void 0 : task.conversationId) === S2.active);
    } };
  }

  // internal/ui/src/remote-input.js
  function createRemoteInput(send, release, failed = () => {
  }) {
    let queue = [], busy = false, buttons = 0, generation = 0, stopped = false, resetting = null;
    async function drain() {
      if (busy || stopped || !queue.length) return;
      busy = true;
      const version = generation, batch = queue.splice(0, 64).map((item) => item.event);
      try {
        await send(batch);
      } catch (error) {
        queue = [];
        buttons = 0;
        generation++;
        await release().catch(() => {
        });
        failed(error);
      } finally {
        busy = false;
        if (version === generation) drain();
      }
    }
    function push(events) {
      if (stopped || resetting) return;
      for (const event of events) {
        const hover = event.type === "move" && buttons === 0, last = queue[queue.length - 1];
        if (hover && (last == null ? void 0 : last.hover)) queue[queue.length - 1] = { event, hover };
        else queue.push({ event, hover });
        if (event.type === "down") buttons |= 1 << event.button;
        if (event.type === "up") buttons &= ~(1 << event.button);
      }
      if (queue.length > 256) {
        reset();
        failed(Error("输入暂时拥堵，已释放按键，请重试"));
        return;
      }
      drain();
    }
    function reset() {
      if (resetting) return resetting;
      queue = [];
      buttons = 0;
      generation++;
      resetting = (async () => {
        while (busy) await new Promise((resolve) => setTimeout(resolve, 5));
        await release().catch(() => {
        });
      })();
      return resetting.finally(() => {
        resetting = null;
      });
    }
    return { push, release: reset, async close() {
      stopped = true;
      await reset();
    } };
  }
  function remotePoint(event, image) {
    const box = image.getBoundingClientRect(), width = Number(image.dataset.width), height = Number(image.dataset.height);
    if (!width || !height || !box.width || !box.height) return { type: "move", x: 0, y: 0 };
    const scale = Math.min(box.width / width, box.height / height), left = box.left + (box.width - width * scale) / 2, top = box.top + (box.height - height * scale) / 2;
    return { type: "move", x: Math.max(0, Math.min(width - 1, Math.round((event.clientX - left) / scale))), y: Math.max(0, Math.min(height - 1, Math.round((event.clientY - top) / scale))) };
  }

  // internal/ui/src/branding.js
  var CLIENT_VERSION = "0.1.17-preview";
  function authShowcase() {
    return '<div class="snowfall" aria-hidden="true"><span></span><span></span><span></span></div><aside class="auth-showcase"><p class="auth-kicker"><i aria-hidden="true"></i> LINKME · 即时通讯</p><h1>每一句，<br>都有回应。</h1><p class="auth-intro">从一句消息，到一次默契的协作。<br>让同事、想法和文件，在这里相遇。</p><div class="auth-features"><span>即时消息</span><span>音视频会议</span><span>文件共享</span></div></aside>';
  }

  // internal/ui/src/cartoon-catalog.js
  var cartoonAvatars = [{ "id": "cartoon:001", "name": "元气小猫", "animal": "小猫", "style": "元气" }, { "id": "cartoon:002", "name": "元气小狗", "animal": "小狗", "style": "元气" }, { "id": "cartoon:003", "name": "元气小熊", "animal": "小熊", "style": "元气" }, { "id": "cartoon:004", "name": "元气兔兔", "animal": "兔兔", "style": "元气" }, { "id": "cartoon:005", "name": "元气狐狸", "animal": "狐狸", "style": "元气" }, { "id": "cartoon:006", "name": "元气熊猫", "animal": "熊猫", "style": "元气" }, { "id": "cartoon:007", "name": "元气考拉", "animal": "考拉", "style": "元气" }, { "id": "cartoon:008", "name": "元气老虎", "animal": "老虎", "style": "元气" }, { "id": "cartoon:009", "name": "元气狮子", "animal": "狮子", "style": "元气" }, { "id": "cartoon:010", "name": "元气小猴", "animal": "小猴", "style": "元气" }, { "id": "cartoon:011", "name": "元气小猪", "animal": "小猪", "style": "元气" }, { "id": "cartoon:012", "name": "元气绵羊", "animal": "绵羊", "style": "元气" }, { "id": "cartoon:013", "name": "元气奶牛", "animal": "奶牛", "style": "元气" }, { "id": "cartoon:014", "name": "元气企鹅", "animal": "企鹅", "style": "元气" }, { "id": "cartoon:015", "name": "元气猫头鹰", "animal": "猫头鹰", "style": "元气" }, { "id": "cartoon:016", "name": "元气青蛙", "animal": "青蛙", "style": "元气" }, { "id": "cartoon:017", "name": "元气小鸡", "animal": "小鸡", "style": "元气" }, { "id": "cartoon:018", "name": "元气浣熊", "animal": "浣熊", "style": "元气" }, { "id": "cartoon:019", "name": "元气海豹", "animal": "海豹", "style": "元气" }, { "id": "cartoon:020", "name": "元气仓鼠", "animal": "仓鼠", "style": "元气" }, { "id": "cartoon:021", "name": "甜梦小猫", "animal": "小猫", "style": "甜梦" }, { "id": "cartoon:022", "name": "甜梦小狗", "animal": "小狗", "style": "甜梦" }, { "id": "cartoon:023", "name": "甜梦小熊", "animal": "小熊", "style": "甜梦" }, { "id": "cartoon:024", "name": "甜梦兔兔", "animal": "兔兔", "style": "甜梦" }, { "id": "cartoon:025", "name": "甜梦狐狸", "animal": "狐狸", "style": "甜梦" }, { "id": "cartoon:026", "name": "甜梦熊猫", "animal": "熊猫", "style": "甜梦" }, { "id": "cartoon:027", "name": "甜梦考拉", "animal": "考拉", "style": "甜梦" }, { "id": "cartoon:028", "name": "甜梦老虎", "animal": "老虎", "style": "甜梦" }, { "id": "cartoon:029", "name": "甜梦狮子", "animal": "狮子", "style": "甜梦" }, { "id": "cartoon:030", "name": "甜梦小猴", "animal": "小猴", "style": "甜梦" }, { "id": "cartoon:031", "name": "甜梦小猪", "animal": "小猪", "style": "甜梦" }, { "id": "cartoon:032", "name": "甜梦绵羊", "animal": "绵羊", "style": "甜梦" }, { "id": "cartoon:033", "name": "甜梦奶牛", "animal": "奶牛", "style": "甜梦" }, { "id": "cartoon:034", "name": "甜梦企鹅", "animal": "企鹅", "style": "甜梦" }, { "id": "cartoon:035", "name": "甜梦猫头鹰", "animal": "猫头鹰", "style": "甜梦" }, { "id": "cartoon:036", "name": "甜梦青蛙", "animal": "青蛙", "style": "甜梦" }, { "id": "cartoon:037", "name": "甜梦小鸡", "animal": "小鸡", "style": "甜梦" }, { "id": "cartoon:038", "name": "甜梦浣熊", "animal": "浣熊", "style": "甜梦" }, { "id": "cartoon:039", "name": "甜梦海豹", "animal": "海豹", "style": "甜梦" }, { "id": "cartoon:040", "name": "甜梦仓鼠", "animal": "仓鼠", "style": "甜梦" }, { "id": "cartoon:041", "name": "花园小猫", "animal": "小猫", "style": "花园" }, { "id": "cartoon:042", "name": "花园小狗", "animal": "小狗", "style": "花园" }, { "id": "cartoon:043", "name": "花园小熊", "animal": "小熊", "style": "花园" }, { "id": "cartoon:044", "name": "花园兔兔", "animal": "兔兔", "style": "花园" }, { "id": "cartoon:045", "name": "花园狐狸", "animal": "狐狸", "style": "花园" }, { "id": "cartoon:046", "name": "花园熊猫", "animal": "熊猫", "style": "花园" }, { "id": "cartoon:047", "name": "花园考拉", "animal": "考拉", "style": "花园" }, { "id": "cartoon:048", "name": "花园老虎", "animal": "老虎", "style": "花园" }, { "id": "cartoon:049", "name": "花园狮子", "animal": "狮子", "style": "花园" }, { "id": "cartoon:050", "name": "花园小猴", "animal": "小猴", "style": "花园" }, { "id": "cartoon:051", "name": "花园小猪", "animal": "小猪", "style": "花园" }, { "id": "cartoon:052", "name": "花园绵羊", "animal": "绵羊", "style": "花园" }, { "id": "cartoon:053", "name": "花园奶牛", "animal": "奶牛", "style": "花园" }, { "id": "cartoon:054", "name": "花园企鹅", "animal": "企鹅", "style": "花园" }, { "id": "cartoon:055", "name": "花园猫头鹰", "animal": "猫头鹰", "style": "花园" }, { "id": "cartoon:056", "name": "花园青蛙", "animal": "青蛙", "style": "花园" }, { "id": "cartoon:057", "name": "花园小鸡", "animal": "小鸡", "style": "花园" }, { "id": "cartoon:058", "name": "花园浣熊", "animal": "浣熊", "style": "花园" }, { "id": "cartoon:059", "name": "花园海豹", "animal": "海豹", "style": "花园" }, { "id": "cartoon:060", "name": "花园仓鼠", "animal": "仓鼠", "style": "花园" }, { "id": "cartoon:061", "name": "眼镜小猫", "animal": "小猫", "style": "眼镜" }, { "id": "cartoon:062", "name": "眼镜小狗", "animal": "小狗", "style": "眼镜" }, { "id": "cartoon:063", "name": "眼镜小熊", "animal": "小熊", "style": "眼镜" }, { "id": "cartoon:064", "name": "眼镜兔兔", "animal": "兔兔", "style": "眼镜" }, { "id": "cartoon:065", "name": "眼镜狐狸", "animal": "狐狸", "style": "眼镜" }, { "id": "cartoon:066", "name": "眼镜熊猫", "animal": "熊猫", "style": "眼镜" }, { "id": "cartoon:067", "name": "眼镜考拉", "animal": "考拉", "style": "眼镜" }, { "id": "cartoon:068", "name": "眼镜老虎", "animal": "老虎", "style": "眼镜" }, { "id": "cartoon:069", "name": "眼镜狮子", "animal": "狮子", "style": "眼镜" }, { "id": "cartoon:070", "name": "眼镜小猴", "animal": "小猴", "style": "眼镜" }, { "id": "cartoon:071", "name": "眼镜小猪", "animal": "小猪", "style": "眼镜" }, { "id": "cartoon:072", "name": "眼镜绵羊", "animal": "绵羊", "style": "眼镜" }, { "id": "cartoon:073", "name": "眼镜奶牛", "animal": "奶牛", "style": "眼镜" }, { "id": "cartoon:074", "name": "眼镜企鹅", "animal": "企鹅", "style": "眼镜" }, { "id": "cartoon:075", "name": "眼镜猫头鹰", "animal": "猫头鹰", "style": "眼镜" }, { "id": "cartoon:076", "name": "眼镜青蛙", "animal": "青蛙", "style": "眼镜" }, { "id": "cartoon:077", "name": "眼镜小鸡", "animal": "小鸡", "style": "眼镜" }, { "id": "cartoon:078", "name": "眼镜浣熊", "animal": "浣熊", "style": "眼镜" }, { "id": "cartoon:079", "name": "眼镜海豹", "animal": "海豹", "style": "眼镜" }, { "id": "cartoon:080", "name": "眼镜仓鼠", "animal": "仓鼠", "style": "眼镜" }, { "id": "cartoon:081", "name": "星光小猫", "animal": "小猫", "style": "星光" }, { "id": "cartoon:082", "name": "星光小狗", "animal": "小狗", "style": "星光" }, { "id": "cartoon:083", "name": "星光小熊", "animal": "小熊", "style": "星光" }, { "id": "cartoon:084", "name": "星光兔兔", "animal": "兔兔", "style": "星光" }, { "id": "cartoon:085", "name": "星光狐狸", "animal": "狐狸", "style": "星光" }, { "id": "cartoon:086", "name": "星光熊猫", "animal": "熊猫", "style": "星光" }, { "id": "cartoon:087", "name": "星光考拉", "animal": "考拉", "style": "星光" }, { "id": "cartoon:088", "name": "星光老虎", "animal": "老虎", "style": "星光" }, { "id": "cartoon:089", "name": "星光狮子", "animal": "狮子", "style": "星光" }, { "id": "cartoon:090", "name": "星光小猴", "animal": "小猴", "style": "星光" }, { "id": "cartoon:091", "name": "星光小猪", "animal": "小猪", "style": "星光" }, { "id": "cartoon:092", "name": "星光绵羊", "animal": "绵羊", "style": "星光" }, { "id": "cartoon:093", "name": "星光奶牛", "animal": "奶牛", "style": "星光" }, { "id": "cartoon:094", "name": "星光企鹅", "animal": "企鹅", "style": "星光" }, { "id": "cartoon:095", "name": "星光猫头鹰", "animal": "猫头鹰", "style": "星光" }, { "id": "cartoon:096", "name": "星光青蛙", "animal": "青蛙", "style": "星光" }, { "id": "cartoon:097", "name": "星光小鸡", "animal": "小鸡", "style": "星光" }, { "id": "cartoon:098", "name": "星光浣熊", "animal": "浣熊", "style": "星光" }, { "id": "cartoon:099", "name": "星光海豹", "animal": "海豹", "style": "星光" }, { "id": "cartoon:100", "name": "星光仓鼠", "animal": "仓鼠", "style": "星光" }];
  var cartoonURL = (value) => /^cartoon:(00[1-9]|0[1-9][0-9]|100)$/.test(value || "") ? "/assets/avatars/" + value.slice(8) + ".svg" : "";
  function cartoonChoices(count = 8, exclude = []) {
    const pool = cartoonAvatars.filter((a) => !exclude.includes(a.id)), random = new Uint32Array(pool.length);
    crypto.getRandomValues(random);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = random[i] % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }
  function cartoonOptions(items, selected) {
    return items.map((a) => '<button type="button" class="cartoon-option ' + (a.id === selected ? "selected" : "") + '" data-cartoon="' + a.id + '" role="radio" aria-checked="' + (a.id === selected) + '" aria-label="' + a.name + '" title="' + a.name + '"><img loading="lazy" src="' + cartoonURL(a.id) + '" alt=""><span>' + a.name + "</span></button>").join("");
  }

  // internal/ui/src/email-auth.js
  function createEmailAuth({ S: S2, action: action2, enter: enter2, QR: QR2, Desktop: Desktop2, windows: windows2, logo: logo2 }) {
    let timer;
    function render(mode = "login", emailValue = "") {
      clearInterval(timer);
      QR2.stop();
      S2.user = null;
      Desktop2.unread();
      const register = mode === "register", reset = mode === "reset", verify = register || reset;
      if (register && !S2.registrationEnabled) return render();
      const choices = register ? cartoonChoices(4) : [];
      document.querySelector("#app").innerHTML = '<main class="auth-shell email-auth '.concat(register ? "registering" : "", '">').concat(windows2()).concat(authShowcase(), '<form class="auth-card" id="auth-form">').concat(logo2(), "<h2>").concat(register ? "创建 LinkMe 账号" : reset ? "找回密码" : "欢迎回来", '</h2><p class="subtitle">').concat(reset ? "验证邮箱，设置新密码" : register ? "用邮箱，开启新的连接" : "邮箱登录，与团队保持连接", "</p>").concat(register ? '<div class="register-avatars"><div class="cartoon-heading"><span>选一个喜欢的头像</span><button type="button" id="register-avatar-shuffle">换一批</button></div><input type="hidden" name="avatar" id="register-avatar" value="'.concat(choices[0].id, '"><div class="cartoon-grid compact" id="register-avatar-options">').concat(cartoonOptions(choices, choices[0].id), "</div></div>") : "", '<div class="auth-fields">').concat(register ? '<input name="name" autocomplete="name" placeholder="姓名（别人能搜索到）" aria-label="姓名" maxlength="32" required>' : "", '<input name="email" type="email" autocomplete="username" inputmode="email" placeholder="邮箱地址" aria-label="邮箱" maxlength="254" required>').concat(verify ? '<div class="email-code-row"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位验证码" aria-label="验证码" pattern="[0-9]{6}" maxlength="6" required><button type="button" class="secondary" id="send-email-code">获取验证码</button></div>' : "", '<input name="password" type="password" autocomplete="').concat(verify ? "new-password" : "current-password", '" placeholder="').concat(verify ? "设置密码（至少 8 位）" : "密码", '" aria-label="密码" minlength="8" maxlength="72" required>').concat(reset ? '<input name="repeatPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" aria-label="确认密码" minlength="8" maxlength="72" required>' : "", '</div><div class="auth-error" id="auth-error" role="status" aria-live="polite"></div><button type="submit" class="primary">').concat(register ? "注册并登录" : reset ? "重设密码" : "登录", "</button>").concat(!verify && S2.config.platform !== "android" ? '<button type="button" class="qr-login-entry" data-action="qr-login">使用二维码登录</button>' : "", '<div class="auth-links">').concat(verify ? '<button type="button" data-email-mode="login">返回登录</button>' : "".concat(S2.registrationEnabled ? '<button type="button" data-email-mode="register">注册账号</button>' : "", '<button type="button" data-email-mode="reset">忘记密码</button>'), '<button type="button" data-action="connection">连接设置</button></div></form><small class="auth-footer">LinkMe ').concat(CLIENT_VERSION, " · 让沟通更近一步</small></main>");
      const form = document.querySelector("#auth-form"), email = form.elements.email, error = form.querySelector("#auth-error");
      email.value = emailValue;
      let challenge = "", challengeEmail = "";
      form.querySelectorAll("[data-email-mode]").forEach((b) => b.onclick = () => render(b.dataset.emailMode, email.value));
      if (register) {
        form.querySelector("#register-avatar-shuffle").onclick = () => {
          const next = cartoonChoices(4);
          form.elements.avatar.value = next[0].id;
          form.querySelector("#register-avatar-options").innerHTML = cartoonOptions(next, next[0].id);
        };
        form.querySelector("#register-avatar-options").onclick = (e) => {
          const b = e.target.closest("[data-cartoon]");
          if (!b) return;
          form.elements.avatar.value = b.dataset.cartoon;
          form.querySelectorAll("[data-cartoon]").forEach((n) => {
            n.classList.toggle("selected", n === b);
            n.setAttribute("aria-checked", String(n === b));
          });
        };
      }
      if (verify) form.querySelector("#send-email-code").onclick = async () => {
        if (!email.reportValidity()) return;
        const button = form.querySelector("#send-email-code");
        button.disabled = true;
        error.textContent = "";
        const address = email.value.trim().toLowerCase();
        try {
          const result = await action2("/api/auth/email/code", { email: address, purpose: mode });
          if (!form.isConnected) return;
          challenge = result.challengeId;
          challengeEmail = address;
          error.textContent = reset ? "如果该邮箱已注册，验证码将发送到邮箱，请查收。" : "验证码已发送，请查收邮箱（含垃圾邮件）。";
          const until = Date.now() + result.retryAfter * 1e3;
          const tick = () => {
            if (!form.isConnected) {
              clearInterval(timer);
              return;
            }
            const left = Math.max(0, Math.ceil((until - Date.now()) / 1e3));
            button.textContent = left ? "".concat(left, " 秒后重发") : "重新发送";
            button.disabled = left > 0;
            if (!left) clearInterval(timer);
          };
          tick();
          timer = setInterval(tick, 500);
        } catch (e) {
          if (form.isConnected) {
            error.textContent = e.message;
            button.disabled = false;
          }
        }
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector("[type=submit]");
        if (button.disabled) return;
        const p = [...new FormData(form)].reduce((value, [key, item]) => (value[key] = item, value), {});
        p.email = p.email.trim().toLowerCase();
        if (verify && (!challenge || p.email !== challengeEmail)) {
          error.textContent = "请先为当前邮箱获取验证码";
          return;
        }
        if (reset && p.password !== p.repeatPassword) {
          error.textContent = "两次输入的密码不一致";
          return;
        }
        delete p.repeatPassword;
        if (verify) p.challengeId = challenge;
        button.disabled = true;
        error.textContent = "";
        try {
          const result = await action2(reset ? "/api/auth/email/reset" : "/api/auth/" + mode, p);
          if (!form.isConnected) return;
          if (reset) {
            render("login", p.email);
            document.querySelector("#auth-error").textContent = "密码已重设，请使用新密码登录";
            return;
          }
          S2.token = result.token;
          localStorage.setItem("welink_token", S2.token);
          S2.user = result.user;
          clearInterval(timer);
          await enter2();
        } catch (e2) {
          if (form.isConnected) {
            error.textContent = e2.message;
            button.disabled = false;
          }
        }
      };
    }
    return { render };
  }

  // internal/appearance/atmosphere.js
  (() => {
    const root = document.documentElement;
    const pause = () => root.classList.add("snow-paused");
    const sync = () => root.classList.toggle("snow-paused", document.hidden || !document.hasFocus());
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", sync);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", sync);
    sync();
  })();

  // internal/ui/src/native-notifications.js
  function createNativeNotifications({ S: S2, action: action2, selectConversation: selectConversation2, refresh: refresh2, toast: toast2 }) {
    var _a;
    const supported = typeof window.welinkMessageNotifications === "function" || !!((_a = window.WeLinkAndroid) == null ? void 0 : _a.messageNotifications);
    let active = false, draining = null;
    async function open() {
      var _a2, _b;
      if (!S2.user) return;
      let raw = "";
      try {
        raw = ((_a2 = window.WeLinkAndroid) == null ? void 0 : _a2.takeMessageNotification) ? window.WeLinkAndroid.takeMessageNotification() : await ((_b = window.welinkTakeMessageNotification) == null ? void 0 : _b.call(window));
        const n = raw ? JSON.parse(raw) : null;
        if (!n || n.userId !== S2.user.id || !/^[a-f0-9]{32}$/.test(n.conversationId)) return;
        await refresh2();
        await selectConversation2(n.conversationId);
      } catch (e) {
        toast2("该聊天暂时无法打开，请在消息列表中查看");
      }
    }
    function drainInvites() {
      if (!S2.user) return Promise.resolve();
      if (draining) return draining;
      draining = (async () => {
        var _a2, _b;
        try {
          let raw, takeEvent = (_a2 = window.WeLinkAndroid) == null ? void 0 : _a2.takeNativeInviteEvent, takeAction = ((_b = window.WeLinkAndroid) == null ? void 0 : _b.takeNativeInviteAction) || window.welinkTakeNativeInviteAction;
          if (takeEvent) while (raw = await takeEvent.call(window.WeLinkAndroid)) window.dispatchEvent(new CustomEvent("welink-native-invite-event", { detail: JSON.parse(raw) }));
          if (takeAction) while (raw = await takeAction.call(window.WeLinkAndroid || window)) window.dispatchEvent(new CustomEvent("welink-native-invite-action", { detail: JSON.parse(raw) }));
        } catch (e) {
        } finally {
          draining = null;
        }
      })();
      return draining;
    }
    async function start() {
      var _a2;
      if (!supported) return;
      await action2("/local/notifications", { token: S2.token });
      (_a2 = window.WeLinkAndroid) == null ? void 0 : _a2.messageNotifications(true);
      active = true;
      await open();
    }
    async function stop() {
      var _a2;
      if (!supported) return;
      active = false;
      (_a2 = window.WeLinkAndroid) == null ? void 0 : _a2.messageNotifications(false);
      await action2("/local/notifications", { token: "" });
    }
    window.addEventListener("welink-open-message", open);
    window.addEventListener("welink-native-invite", drainInvites);
    window.addEventListener("welink-native-invite-action", (event) => {
      if (!event.detail) drainInvites();
    });
    window.addEventListener("focus", () => {
      if (active) {
        open();
        drainInvites();
      } else if (S2.user) start().catch(() => {
      });
    });
    return { start, stop, drainInvites, active: () => active };
  }

  // internal/ui/src/meeting-window.js
  var owner = null;
  function meetingWindow({ active, changed, toast: toast2, nativeFullscreen }) {
    let nativeFull = false, busy = false, entry = null, leaving = null, native;
    const controller = { exit }, full = () => owner === controller && (nativeFull || !!document.fullscreenElement);
    async function exit() {
      if (leaving) return leaving;
      leaving = (async () => {
        if (entry) try {
          await entry;
        } catch (e) {
        }
        if (owner !== controller) return;
        if (nativeFull) {
          await native(false);
          nativeFull = false;
        }
        if (document.fullscreenElement) await document.exitFullscreen();
        if (owner === controller) owner = null;
        changed(false);
      })();
      try {
        await leaving;
      } finally {
        leaving = null;
      }
    }
    async function toggle() {
      if (busy || !active()) return;
      busy = true;
      try {
        if (full()) {
          await exit();
          return;
        }
        if (owner && owner !== controller) await owner.exit();
        if (!active()) return;
        owner = controller;
        native = nativeFullscreen || window.welinkMeetingFullscreen;
        entry = (async () => {
          if (native) {
            await native(true);
            nativeFull = true;
          } else await document.documentElement.requestFullscreen();
        })();
        try {
          await entry;
        } finally {
          entry = null;
        }
        changed(full());
        if (!active()) await exit();
      } catch (e) {
        if (owner === controller && !nativeFull && !document.fullscreenElement) owner = null;
        changed(full());
        toast2("无法切换全屏，请重试");
      } finally {
        busy = false;
      }
    }
    document.addEventListener("fullscreenchange", () => {
      if (owner !== controller) return;
      if (!nativeFull && !entry && !document.fullscreenElement) owner = null;
      changed(full());
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && full() && active()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exit().catch(() => toast2("退出全屏失败，请重试"));
      }
    }, true);
    return { toggle, exit, full };
  }

  // internal/ui/src/remote-window.js
  function createRemoteWindow({ active, action: action2, toast: toast2 }) {
    var _a;
    const display = meetingWindow({ active, toast: toast2, nativeFullscreen: ((_a = window.WeLinkAndroid) == null ? void 0 : _a.setRemoteFullscreen) ? (enabled) => window.WeLinkAndroid.setRemoteFullscreen(enabled) : void 0, changed: (full) => {
      var _a2;
      const b = document.querySelector("[data-action=remote-fullscreen]");
      if (b) {
        b.textContent = full ? "退出全屏" : "全屏";
        b.setAttribute("aria-pressed", String(full));
        b.title = full ? "退出全屏（Esc）" : "全屏";
      }
      (_a2 = document.querySelector(".remote-screen")) == null ? void 0 : _a2.classList.toggle("remote-fullscreen", full);
      action2("/local/remote/release").catch(() => {
      });
    } });
    window.WeLinkRemoteFullscreenExited = () => display.exit().catch(() => {
    });
    return __spreadProps(__spreadValues({}, display), { async minimize() {
      await display.exit();
      if (active()) await action2("/local/window/min");
    }, back() {
      if (!display.full()) return false;
      display.exit().catch(() => {
      });
      return true;
    } });
  }

  // internal/ui/src/long-press.js
  function bindLongPress(selector, onHold, { delay = 500, distance = 10 } = {}) {
    let timer, start, held = false, ghostUntil = 0, target = null, started = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    const key = (node) => (node == null ? void 0 : node.dataset.message) || (node == null ? void 0 : node.dataset.conversation) || (node == null ? void 0 : node.dataset.profile);
    const fire = () => {
      var _a;
      const node = (_a = document.elementFromPoint(start.x, start.y)) == null ? void 0 : _a.closest(selector);
      if (node && key(node) === key(target)) {
        held = true;
        onHold(node, start.x, start.y);
      }
    };
    document.addEventListener("touchstart", (event) => {
      cancel();
      ghostUntil = 0;
      held = false;
      start = null;
      target = null;
      const node = event.target.closest(selector);
      if (!node || event.touches.length !== 1) return;
      const p = event.touches[0];
      start = { x: p.clientX, y: p.clientY };
      target = node;
      started = Date.now();
      timer = setTimeout(fire, delay);
    }, { passive: true });
    document.addEventListener("touchmove", (event) => {
      const p = event.touches[0];
      if (!p || !start || Math.hypot(p.clientX - start.x, p.clientY - start.y) > distance) cancel();
    }, { passive: true });
    document.addEventListener("touchend", () => {
      if (timer && !held && Date.now() - started >= delay) fire();
      cancel();
      if (held) ghostUntil = Date.now() + 900;
      held = false;
    }, { passive: true });
    document.addEventListener("touchcancel", () => {
      cancel();
      held = false;
      ghostUntil = 0;
    }, { passive: true });
    document.addEventListener("click", (event) => {
      var _a;
      if ((held || Date.now() < ghostUntil) && event.detail !== 0 && ((_a = event.sourceCapabilities) == null ? void 0 : _a.firesTouchEvents) !== false) {
        cancel();
        held = false;
        ghostUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  // internal/ui/src/directory-search.js
  function createDirectorySearch({ S: S2, api: api2, esc: esc2, av: av2, icon: icon2, renderSidebar: renderSidebar2, contextMenu: contextMenu2 }) {
    let key = "", version = 0, timer, data = null, loading = false, error = "";
    const matches = (u, q) => (u.name + " " + (u.remark || "") + " " + u.number).toLowerCase().includes(q.toLowerCase());
    const group = (g) => g.group ? __spreadProps(__spreadValues({ id: g.id, name: g.name }, g.group), { joined: true }) : g;
    const unique = (items) => [...new Map(items.map((u) => [u.id, u])).values()];
    function render(query) {
      const q = query.trim(), next = S2.token + "\n" + q;
      const users = unique([S2.user, ...S2.friends].filter((u) => u && matches(u, q))), groups = unique([...S2.myGroups || [], ...S2.conversations.filter((c) => c.kind === "group").map(group)].filter((g) => matches(g, q)));
      if (next !== key) {
        key = next;
        data = null;
        loading = true;
        error = "";
        clearTimeout(timer);
        const v = ++version;
        timer = setTimeout(async () => {
          try {
            const [people, rooms] = await Promise.all([api2("/api/users?q=" + encodeURIComponent(q)), api2("/api/groups?q=" + encodeURIComponent(q))]);
            if (v !== version || key !== next) return;
            data = { users: people, groups: rooms };
          } catch (e) {
            if (v !== version) return;
            error = e.message;
          } finally {
            if (v === version) {
              loading = false;
              if (S2.search.trim() === q) renderSidebar2();
            }
          }
        }, 180);
      }
      const foundUsers = unique([...users, ...(data == null ? void 0 : data.users) || []]), foundGroups = unique([...groups, ...(data == null ? void 0 : data.groups) || []]);
      return '<div class="directory-results">' + (foundUsers.length ? '<div class="search-section-label">用户</div>' + foundUsers.map((u) => '<div class="user-search-result" data-search-user="'.concat(u.id, '"><button class="conversation-row" ').concat(u.id === S2.user.id ? "data-profile" : "data-start-chat", '="').concat(u.id, '">').concat(av2(u, "", true), '<div class="row-text"><div class="row-title"><b>').concat(esc2(u.remark || u.name)).concat(u.id === S2.user.id ? "（我）" : "", '</b></div><div class="row-preview">').concat(esc2(u.number), "</div></div></button>").concat(u.id !== S2.user.id ? '<div class="user-search-actions"><button data-user-call="' + u.id + '" data-user-call-mode="audio" title="语音通话">' + icon2("phone") + '</button><button data-user-call="' + u.id + '" data-user-call-mode="video" title="视频通话">' + icon2("video") + "</button></div>" : "", "</div>")).join("") : "") + (foundGroups.length ? '<div class="search-section-label">群聊</div>' + foundGroups.map((g) => '<button class="conversation-row directory-group" data-group-join="'.concat(g.id, '" data-joined="').concat(g.joined === true, '" data-mode="').concat(esc2(g.joinMode), '" data-name="').concat(esc2(g.name), '" ').concat(!g.joined && g.joinMode === "closed" ? "disabled" : "", ">").concat(av2({ kind: "group", avatar: g.avatar }), '<div class="row-text"><div class="row-title"><b>').concat(esc2(g.name), '</b></div><div class="row-preview">').concat(esc2(g.number), " · ").concat(g.count || 0, " 人 · ").concat(g.joined ? "发消息" : g.joinMode === "closed" ? "暂不开放" : g.joinMode === "approval" ? "申请加入" : "加入群聊", "</div></div></button>")).join("") : "") + (loading ? '<div class="directory-status">正在搜索…</div>' : error ? '<div class="directory-status" role="status">' + esc2(error) + "</div>" : !foundUsers.length && !foundGroups.length ? '<div class="empty-list">没有找到用户或群聊</div>' : "") + "</div>";
    }
    function userMenu(id, x, y) {
      var _a;
      if (id === ((_a = S2.user) == null ? void 0 : _a.id)) return;
      contextMenu2(x, y, '<button data-start-chat="' + id + '">发消息</button><button data-create-group-user="' + id + '">创建群聊</button>');
    }
    document.addEventListener("contextmenu", (e) => {
      const row = e.target.closest("[data-search-user]");
      if (row) {
        e.preventDefault();
        userMenu(row.dataset.searchUser, e.clientX, e.clientY);
      }
    });
    bindLongPress("[data-search-user]", (row, x, y) => userMenu(row.dataset.searchUser, x, y));
    return { render, changed() {
      key = "";
      version++;
      clearTimeout(timer);
    }, reset() {
      key = "";
      version++;
      clearTimeout(timer);
      data = null;
    } };
  }

  // internal/ui/src/theme.js
  function applyTheme(dark) {
    var _a, _b, _c, _d;
    document.body.classList.toggle("dark", dark);
    document.documentElement.style.backgroundColor = dark ? "#22252b" : "#f5f4f9";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    (_a = document.querySelector("meta[name=theme-color]")) == null ? void 0 : _a.setAttribute("content", dark ? "#22252b" : "#0099ff");
    (_c = (_b = window.WeLinkAndroid) == null ? void 0 : _b.setDarkTheme) == null ? void 0 : _c.call(_b, dark);
    (_d = window.welinkTheme) == null ? void 0 : _d.call(window, dark).catch(() => {
    });
  }

  // internal/ui/src/message-sounds.js
  function createMessageSounds({ toast: toast2, native, hidden }) {
    var _a;
    const key = "welink_message_sound";
    let enabled = localStorage.getItem(key) !== "false", context = null, last = 0;
    const ready = ((_a = window.WeLinkAndroid) == null ? void 0 : _a.getMessageSound) ? Promise.resolve().then(() => {
      enabled = window.WeLinkAndroid.getMessageSound();
      localStorage.setItem(key, String(enabled));
    }) : native ? window.welinkDesktopSettings().then((p) => {
      enabled = p.messageSound !== false;
      localStorage.setItem(key, String(enabled));
    }).catch(() => {
    }) : Promise.resolve();
    function unlock() {
      if (!enabled) return;
      try {
        if (!context || context.state === "closed") {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (Audio) context = new Audio();
        }
        context == null ? void 0 : context.resume().catch(() => {
        });
      } catch (e) {
      }
    }
    async function set(value) {
      var _a2, _b;
      (_b = (_a2 = window.WeLinkAndroid) == null ? void 0 : _a2.setMessageSound) == null ? void 0 : _b.call(_a2, value);
      if (native) {
        const p = await window.welinkDesktopSettings();
        await window.welinkDesktopSave(__spreadProps(__spreadValues({}, p), { messageSound: value }));
      }
      enabled = value;
      localStorage.setItem(key, String(value));
      if (!value) {
        context == null ? void 0 : context.close().catch(() => {
        });
        context = null;
      } else unlock();
    }
    function notify() {
      if (!enabled || native && hidden() || Date.now() - last < 1500) return;
      last = Date.now();
      unlock();
      if (!context) return;
      try {
        [{ frequency: 1046.5, delay: 0, length: 0.13 }, { frequency: 880, delay: 0.19, length: 0.16 }].forEach((pulse) => {
          const oscillator = context.createOscillator(), gain = context.createGain(), at = context.currentTime + pulse.delay, end = at + pulse.length;
          oscillator.type = "sine";
          oscillator.frequency.value = pulse.frequency;
          gain.gain.setValueAtTime(1e-4, at);
          gain.gain.exponentialRampToValueAtTime(0.045, at + 8e-3);
          gain.gain.exponentialRampToValueAtTime(1e-3, end);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(at);
          oscillator.stop(end);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
          };
        });
      } catch (e) {
      }
    }
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("change", async (e) => {
      if (e.target.id !== "pref-message-sound") return;
      const input = e.target, value = input.checked;
      input.disabled = true;
      try {
        await set(value);
        toast2(value ? "已开启消息提示音" : "已关闭消息提示音");
      } catch (error) {
        input.checked = enabled;
        toast2(String(error));
      } finally {
        input.disabled = false;
      }
    });
    window.addEventListener("storage", (e) => {
      if (e.key === key) enabled = e.newValue !== "false";
    });
    return { ready, notify, enabled: () => enabled, row: () => '<label class="prefs-row" for="pref-message-sound"><span>消息提示音</span><input type="checkbox" id="pref-message-sound" ' + (enabled ? "checked" : "") + '></label><p class="hint">立即生效，保存在本设备；关闭声音仍保留通知和未读标记。</p>', reset() {
      context == null ? void 0 : context.close().catch(() => {
      });
      context = null;
      last = 0;
    } };
  }

  // internal/ui/src/navigation.js
  function createNavigation({ getHandler, setHandler, beforeOpen, esc: esc2, icon: icon2, onPageBack, beforeBack }) {
    const stack = [];
    const host = () => document.getElementById("overlays");
    const dialog = () => host().querySelector(".modal");
    const focus = (node) => {
      if (node == null ? void 0 : node.isConnected) node.focus({ preventScroll: true });
    };
    function clear() {
      stack.length = 0;
      host().innerHTML = "";
      setHandler(null);
    }
    function open(title, body, footer = "", wide = false) {
      var _a;
      beforeOpen();
      const current = dialog(), previousFocus = document.activeElement;
      const transient = /截图|录音|视频预览|语音消息|远程协助|邀请|来电|登录 Windows/.test(title) || (current == null ? void 0 : current.querySelector("canvas,video,audio,.qr-confirm,.remote-invite"));
      if (transient) stack.length = 0;
      else if (current) {
        const previous = stack.findIndex((item) => item.title === title);
        if (previous >= 0) stack.splice(previous);
        else if (current.getAttribute("aria-label") !== title) {
          stack.push({ title: current.getAttribute("aria-label"), node: host().firstElementChild, handler: getHandler(), focus: previousFocus, scroll: ((_a = current.querySelector(".modal-body")) == null ? void 0 : _a.scrollTop) || 0 });
          if (stack.length > 12) stack.shift();
        }
      } else stack.length = 0;
      host().innerHTML = '<div class="modal-backdrop"><section class="modal '.concat(wide ? "wide" : "", '" role="dialog" aria-modal="true" aria-label="').concat(esc2(title), '"><header class="modal-head"><button type="button" class="dialog-back" data-action="modal-back" aria-label="返回').concat(stack.length ? "上一页" : "", '" title="').concat(stack.length ? "返回上一页" : "返回", '">').concat(icon2("back"), "<span>返回</span></button><h3>").concat(esc2(title), '</h3><button type="button" class="icon-btn" data-action="close-modal" aria-label="关闭" title="关闭">').concat(icon2("close"), '</button></header><div class="modal-body">').concat(body, '<div class="form-error" id="modal-error" role="alert"></div></div>').concat(footer ? '<footer class="modal-footer">'.concat(footer, "</footer>") : "", "</section></div>");
      setHandler(null);
      if (!matchMedia("(max-width:700px)").matches) {
        const opened = dialog();
        setTimeout(() => {
          if ((opened == null ? void 0 : opened.isConnected) && !opened.contains(document.activeElement)) focus(opened.querySelector("input:not([type=checkbox]):not([type=file]):not([type=range])") || opened.querySelector(".dialog-back"));
        }, 40);
      }
    }
    function back() {
      var _a, _b;
      if (!host().firstElementChild) return false;
      if (beforeBack == null ? void 0 : beforeBack()) return true;
      const cancelAvatar = (_a = dialog()) == null ? void 0 : _a.querySelector("[data-avatar=cancel]");
      if (cancelAvatar) {
        cancelAvatar.click();
        return true;
      }
      beforeOpen();
      const prior = stack.pop();
      if (prior) {
        host().innerHTML = "";
        host().appendChild(prior.node);
        setHandler(prior.handler);
        const body = (_b = dialog()) == null ? void 0 : _b.querySelector(".modal-body");
        if (body) body.scrollTop = prior.scroll;
        focus(prior.focus);
      } else clear();
      return true;
    }
    function handleBack() {
      var _a;
      const menu = document.querySelector(".context-menu,.popup");
      if (menu) {
        menu.remove();
        return true;
      }
      if (back()) return true;
      if (document.querySelector(".qr-auth")) {
        (_a = document.querySelector("[data-action=login]")) == null ? void 0 : _a.click();
        return true;
      }
      return onPageBack();
    }
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || !dialog()) return;
      const controls = [...dialog().querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter((node) => !node.disabled && node.getClientRects().length), first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        focus(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focus(first);
      }
    });
    window.WeLinkGoBack = handleBack;
    function complete() {
      if (stack.some((item) => item.title === "设置")) back();
      else clear();
    }
    return { open, clear, back, handleBack, complete };
  }

  // internal/ui/src/conversation-actions.js
  function createConversationActions({ S: S2, api: api2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, contextMenu: contextMenu2, refresh: refresh2 }) {
    const find = (id) => S2.conversations.find((c) => c.id === id);
    function menu(id, x, y) {
      const c = find(id);
      if (!c) return;
      contextMenu2(x, y, "".concat(c.kind === "direct" ? '<button data-create-group-user="' + c.peer.id + '">创建群聊</button>' : "", '<button data-conversation-action="pin" data-cid="').concat(id, '">').concat(icon2("pin")).concat(c.pinned ? "取消置顶" : "置顶聊天", '</button><button data-conversation-action="mute" data-cid="').concat(id, '">').concat(icon2("mute")).concat(c.muted ? "开启消息提醒" : "消息免打扰", "</button>").concat(c.unread ? '<button data-conversation-action="read" data-cid="'.concat(id, '">').concat(icon2("check"), "标为已读</button>") : "", '<button class="destructive" data-conversation-action="remove" data-cid="').concat(id, '">').concat(icon2("trash"), "从消息列表移除</button>"));
    }
    const removing = /* @__PURE__ */ new Set();
    async function remove(id) {
      if (!find(id) || removing.has(id)) return;
      removing.add(id);
      try {
        await api2("/api/conversations/" + id, { method: "DELETE" });
        closeModal2();
        await refresh2();
      } catch (error) {
        toast2(error.message);
      } finally {
        removing.delete(id);
      }
    }
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-conversation-menu],[data-conversation-action]");
      if (!button || !S2.user) return;
      if (button.dataset.conversationMenu) {
        const r = button.getBoundingClientRect();
        menu(button.dataset.conversationMenu, r.right - 180, r.bottom);
        return;
      }
      const id = button.dataset.cid, c = find(id);
      if (!c) return;
      try {
        const action2 = button.dataset.conversationAction;
        if (action2 === "remove") {
          remove(id);
          return;
        }
        button.disabled = true;
        if (action2 === "read") await api2("/api/conversations/" + id + "/read", { method: "POST", body: {} });
        else await api2("/api/conversations/" + id, { method: "PATCH", body: action2 === "pin" ? { pinned: !c.pinned } : { muted: !c.muted } });
        await refresh2();
      } catch (error) {
        toast2(error.message);
      } finally {
        button.disabled = false;
      }
    });
    document.addEventListener("contextmenu", (event) => {
      const row = event.target.closest("[data-conversation]");
      if (row) {
        event.preventDefault();
        menu(row.dataset.conversation, event.clientX, event.clientY);
      }
    });
    bindLongPress("[data-conversation]", (row, x, y) => menu(row.dataset.conversation, x, y));
    return { menu, remove };
  }

  // internal/ui/src/cloud.js
  function createCloud({ S: S2, api: api2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, bytes: bytes2, fullTime: fullTime2, upload: upload2 }) {
    const $2 = (s) => document.querySelector(s);
    let drive = [], folders = [], path = [], folderID = "", offset = 0, driveQuery = "", searchDraft = "", driveGeneration = 0, uploading = false;
    const owns = (token) => S2.user && S2.token === token && !S2.signingOut;
    const request = api2;
    api2 = async (...args) => {
      const token = S2.token;
      const result = await request(...args);
      if (!owns(token)) throw Object.assign(Error("操作已结束"), { name: "AbortError" });
      return result;
    };
    async function copy(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.append(input);
        input.select();
        const ok = document.execCommand("copy");
        input.remove();
        if (!ok) throw Error("复制失败，请手动选择文本复制");
      }
      toast2("已复制");
    }
    function fail(error) {
      if (error.name === "AbortError") return;
      const target = $2("#modal-error");
      if (target) target.textContent = error.message;
      else toast2(error.message);
    }
    function bind(id, fn) {
      const button = $2("#" + id);
      if (button) button.onclick = async () => {
        button.disabled = true;
        try {
          await fn();
        } catch (error) {
          fail(error);
        } finally {
          button.disabled = false;
        }
      };
    }
    const crumbs = (items, attr) => "<button ".concat(attr, '="">全部文件</button>') + items.map((f) => "<span> / </span><button ".concat(attr, '="').concat(f.id, '">').concat(esc2(f.name), "</button>")).join("");
    function enter2(id) {
      if ($2(".cloud-page")) $2(".cloud-page").scrollTop = 0;
      folderID = id;
      driveQuery = "";
      searchDraft = "";
      renderDrive().catch(fail);
    }
    async function renderDrive(reset = true) {
      var _a;
      const token = S2.token, g = ++driveGeneration;
      let result;
      if (reset) offset = 0;
      try {
        result = await api2("/api/drive?folder=" + encodeURIComponent(folderID) + "&q=" + encodeURIComponent(driveQuery) + "&offset=" + offset);
      } catch (error) {
        if (g !== driveGeneration || S2.tab !== "drive") return;
        if (error.status === 404 && folderID) {
          toast2("文件夹已删除，已返回全部文件");
          enter2("");
          return;
        }
        throw error;
      }
      if (!owns(token) || g !== driveGeneration || S2.tab !== "drive") return;
      drive = reset ? result.files : [...drive, ...result.files];
      folders = result.folders || [];
      path = result.path || [];
      const prior = $2("#drive-search"), focused = document.activeElement === prior, selection = focused ? [prior.selectionStart, prior.selectionEnd] : null, scroll = ((_a = $2(".cloud-page")) == null ? void 0 : _a.scrollTop) || 0;
      $2("#main-content").innerHTML = '<section class="cloud-page"><header class="cloud-heading"><div><h2>我的网盘</h2><p>文件随账号保存，随时取用和分享</p></div><div class="drive-heading-actions"><button class="secondary" id="drive-new-folder">'.concat(icon2("folder"), '新建文件夹</button><button class="primary" id="drive-upload" ').concat(uploading ? "disabled" : "", ">").concat(icon2("plus")).concat(uploading ? "上传中…" : "上传文件", '</button></div><input type="file" multiple id="drive-file-input" hidden></header><div class="drive-capacity"><div><b>免费 ').concat(bytes2(result.quota), " 空间</b><span>").concat(bytes2(result.used), " / ").concat(bytes2(result.quota), '</span></div><progress value="').concat(result.used, '" max="').concat(result.quota, '"></progress><small>聊天附件不占用这份容量</small></div><div id="drive-upload-status" class="cloud-upload-status"></div><nav class="drive-breadcrumb" aria-label="网盘路径">').concat(crumbs(path, "data-drive-folder"), '</nav><label class="cloud-search">').concat(icon2("search"), '<input id="drive-search" placeholder="搜索当前文件夹" value="').concat(esc2(searchDraft), '"><button id="drive-search-submit" aria-label="搜索当前文件夹">搜索</button>').concat(driveQuery ? '<button id="drive-search-clear" aria-label="清除网盘搜索">' + icon2("close") + "</button>" : "", '</label><div class="cloud-file-list">').concat(folders.map((f) => '<article class="cloud-file cloud-folder"><button class="drive-folder-open" data-drive-folder="'.concat(f.id, '">').concat(icon2("folder"), "<span><b>").concat(esc2(f.name), '</b><small>文件夹</small></span></button><div class="cloud-file-actions"><button data-folder-action="rename" data-id="').concat(f.id, '">重命名</button><button data-folder-action="delete" data-id="').concat(f.id, '" aria-label="删除文件夹">').concat(icon2("trash"), "</button></div></article>")).join("")).concat(drive.map((f) => '<article class="cloud-file"><span class="cloud-file-icon">'.concat(icon2("file"), '</span><div class="cloud-file-name"><b>').concat(esc2(f.name), "</b><small>").concat(bytes2(f.size), " · ").concat(fullTime2(f.updated), '</small></div><div class="cloud-file-actions"><button data-drive="download" data-id="').concat(f.id, '" title="下载" aria-label="下载">').concat(icon2("download"), '</button><button data-drive="share" data-id="').concat(f.id, '" title="分享" aria-label="分享">').concat(icon2("copy"), '</button><button data-drive="move" data-id="').concat(f.id, '">移动</button><button data-drive="rename" title="重命名" data-id="').concat(f.id, '">重命名</button><button data-drive="delete" data-id="').concat(f.id, '" title="删除" aria-label="删除">').concat(icon2("trash"), "</button></div></article>")).join("")).concat(!drive.length && !folders.length ? '<div class="cloud-empty">' + icon2("folder") + "<h3>" + (driveQuery ? "没有匹配的文件或文件夹" : "这个文件夹还是空的") + "</h3><p>" + (driveQuery ? "换个关键词试试，或清除搜索" : "新建文件夹，或上传、拖入文件") + "</p></div>" : "", "</div>").concat(result.hasMore ? '<button id="drive-more" class="secondary cloud-more">加载更多</button>' : "", "</section>");
      bind("drive-new-folder", () => editName());
      bind("drive-upload", () => $2("#drive-file-input").click());
      $2("#drive-file-input").onchange = (e) => {
        sendFiles([...e.target.files]);
        e.target.value = "";
      };
      $2("#drive-search").oninput = (e) => {
        searchDraft = e.target.value;
      };
      const search = () => {
        driveQuery = searchDraft.trim();
        searchDraft = driveQuery;
        return renderDrive();
      };
      $2("#drive-search").onkeydown = (e) => {
        if (e.key === "Enter") search().catch(fail);
      };
      bind("drive-search-submit", search);
      bind("drive-search-clear", () => {
        driveQuery = "";
        searchDraft = "";
        return renderDrive();
      });
      bind("drive-more", () => {
        offset = drive.length;
        return renderDrive(false);
      });
      $2(".cloud-page").scrollTop = scroll;
      if (focused) {
        $2("#drive-search").focus({ preventScroll: true });
        $2("#drive-search").setSelectionRange(...selection);
      }
    }
    async function sendFiles(files) {
      var _a;
      if (!files.length) return;
      if (uploading) {
        toast2("正在上传，请稍后再添加文件");
        return;
      }
      const token = S2.token, targetFolder = folderID;
      uploading = true;
      (_a = $2("#drive-upload")) == null ? void 0 : _a.setAttribute("disabled", "");
      try {
        for (const file of files) {
          if (!owns(token)) return;
          const display = (percent) => {
            const target = S2.tab === "drive" && folderID === targetFolder ? $2("#drive-upload-status") : null;
            if (target) target.textContent = file.name + " · " + (percent === 100 ? "正在保存" : percent === null ? "正在上传" : "已上传 " + percent + "%");
          };
          await upload2("/api/drive/files?folder=" + encodeURIComponent(targetFolder), file, {}, display);
        }
        if (owns(token)) toast2("上传完成");
      } catch (error) {
        fail(error);
      } finally {
        uploading = false;
        if (owns(token) && S2.tab === "drive") await renderDrive().catch(fail);
      }
    }
    function downloadDrive(f) {
      var _a;
      if ((_a = window.WeLinkAndroid) == null ? void 0 : _a.downloadDriveFile) {
        window.WeLinkAndroid.downloadDriveFile(f.id, f.name);
        return;
      }
      const a = document.createElement("a");
      a.href = "/api/drive/files/" + f.id;
      a.download = f.name;
      document.body.append(a);
      a.click();
      a.remove();
    }
    function share(f) {
      modal2("分享文件", '<p class="hint">'.concat(esc2(f.name), '</p><p><b>永久有效</b></p><p class="hint">拿到链接的人可以下载这个文件。重复获取会使用同一链接；主动取消分享、删除文件或账号后失效。</p><div id="drive-share-result"></div>'), '<button class="secondary" id="drive-revoke">取消已有分享</button><button class="primary" id="drive-create-share">获取分享链接</button>');
      const host = $2("#drive-share-result");
      bind("drive-create-share", async () => {
        const result = await api2("/api/drive/files/" + f.id + "/share", { method: "POST", body: {} });
        if (!host.isConnected) return;
        host.innerHTML = '<textarea id="drive-share-url" readonly>' + esc2(result.url) + '</textarea><button class="secondary" id="drive-copy-share">复制分享链接</button>';
        bind("drive-copy-share", () => copy(result.url));
      });
      bind("drive-revoke", async () => {
        await api2("/api/drive/files/" + f.id + "/share", { method: "DELETE" });
        if (host.isConnected) closeModal2();
        toast2("分享链接已失效");
      });
    }
    function editName(f, isFolder = true) {
      const creating = !f, parentID = folderID;
      modal2(creating ? "新建文件夹" : isFolder ? "重命名文件夹" : "重命名文件", '<label>名称</label><input id="drive-rename" maxlength="240" value="' + esc2((f == null ? void 0 : f.name) || "") + '" placeholder="' + (isFolder ? "文件夹名称" : "文件名") + '">', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="drive-save-name">' + (creating ? "创建" : "保存") + "</button>");
      const input = $2("#drive-rename");
      bind("drive-save-name", async () => {
        const name = input.value.trim();
        if (!name) throw Error("请输入名称");
        await api2(creating ? "/api/drive/folders" : "/api/drive/" + (isFolder ? "folders/" : "files/") + f.id, { method: creating ? "POST" : "PATCH", body: creating ? { name, parentId: parentID } : { name } });
        if (input.isConnected) closeModal2();
        await renderDrive();
      });
      input.onkeydown = (e) => {
        var _a;
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          (_a = $2("#drive-save-name")) == null ? void 0 : _a.click();
        }
      };
    }
    async function move(f) {
      modal2("移动文件", '<p class="hint">选择目标文件夹：' + esc2(f.name) + '</p><div id="drive-move-folders"></div>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="drive-move-confirm" disabled>移动到这里</button>');
      const host = $2("#drive-move-folders"), confirm = $2("#drive-move-confirm");
      let target = f.folderId || "", generation = 0;
      async function load(id) {
        const g = ++generation;
        confirm.disabled = true;
        try {
          const result = await api2("/api/drive?folder=" + encodeURIComponent(id));
          if (!host.isConnected || g !== generation) return;
          target = id;
          host.innerHTML = '<nav class="drive-breadcrumb">' + crumbs(result.path || [], "data-move-folder") + '</nav><div class="drive-picker-list">' + (result.folders || []).map((item) => '<button data-move-folder="' + item.id + '">' + icon2("folder") + "<span>" + esc2(item.name) + "</span>" + icon2("chevron") + "</button>").join("") + "</div>";
          confirm.disabled = target === (f.folderId || "");
        } catch (error) {
          if (host.isConnected && g === generation) fail(error);
        }
      }
      host.onclick = (e) => {
        const button = e.target.closest("[data-move-folder]");
        if (button) load(button.dataset.moveFolder);
      };
      bind("drive-move-confirm", async () => {
        await api2("/api/drive/files/" + f.id + "/move", { method: "POST", body: { folderId: target } });
        if (host.isConnected) closeModal2();
        toast2("已移动");
        await renderDrive();
      });
      await load(target);
    }
    document.addEventListener("click", async (event) => {
      if (!S2.user || S2.tab !== "drive") return;
      const open = event.target.closest("[data-drive-folder]");
      if (open) {
        enter2(open.dataset.driveFolder);
        return;
      }
      const button = event.target.closest("[data-drive],[data-folder-action]");
      if (!button) return;
      try {
        const isFolder = !!button.dataset.folderAction, f = (isFolder ? folders : drive).find((f2) => f2.id === button.dataset.id);
        if (!f) return;
        switch (button.dataset.drive || button.dataset.folderAction) {
          case "download":
            downloadDrive(f);
            break;
          case "share":
            share(f);
            break;
          case "move":
            await move(f);
            break;
          case "rename":
            editName(f, isFolder);
            break;
          case "delete":
            modal2(isFolder ? "删除文件夹" : "删除网盘文件", "<p>确定删除「" + esc2(f.name) + "」？" + (isFolder ? "其子文件夹和文件也会一并删除。" : "") + "相关分享链接将失效，此操作无法撤销。</p>", '<button class="secondary" data-action="close-modal">取消</button><button class="primary danger" id="drive-confirm-delete">删除</button>');
            bind("drive-confirm-delete", async () => {
              await api2("/api/drive/" + (isFolder ? "folders/" : "files/") + f.id, __spreadValues({ method: "DELETE" }, isFolder ? { body: { confirmName: f.name } } : {}));
              closeModal2();
              await renderDrive();
            });
            break;
        }
      } catch (error) {
        fail(error);
      }
    });
    return { renderDrive, sendFiles, back() {
      if (!folderID) return false;
      enter2(path.length > 1 ? path[path.length - 2].id : "");
      return true;
    }, reset() {
      driveGeneration++;
      drive = [];
      folders = [];
      path = [];
      folderID = "";
      driveQuery = "";
      searchDraft = "";
    }, changed(type) {
      if (type === "drive" && S2.tab === "drive" && !uploading) renderDrive().catch(fail);
    } };
  }

  // internal/ui/src/admin.js
  function createAdmin({ S: S2, api: api2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, refresh: refresh2 }) {
    const $2 = (s) => document.querySelector(s);
    let generation = 0, currentQuery = "";
    const request = api2;
    api2 = async (...args) => {
      const token = S2.token, result = await request(...args);
      if (!S2.user || S2.signingOut || S2.token !== token) throw Object.assign(Error("操作已结束"), { name: "AbortError" });
      return result;
    };
    function bind(id, fn) {
      const button = $2("#" + id);
      if (button) button.onclick = async () => {
        button.disabled = true;
        try {
          await fn();
        } catch (error) {
          const n = $2("#modal-error");
          if (n) n.textContent = error.message;
          else toast2(error.message);
        } finally {
          button.disabled = false;
        }
      };
    }
    async function render(query = currentQuery) {
      const token = S2.token, g = ++generation, users = await api2("/api/admin/users?q=" + encodeURIComponent(query));
      if (S2.token !== token || S2.tab !== "admin" || g !== generation) return;
      currentQuery = query;
      $2("#main-content").innerHTML = '<section class="cloud-page admin-page"><header class="cloud-heading"><div><h2>账号管理</h2><p>注册账号、修改资料、重置密码与删除账号</p></div><button class="primary" id="admin-create">'.concat(icon2("plus"), '注册账号</button></header><label class="cloud-search">').concat(icon2("search"), '<input id="admin-search" placeholder="搜索姓名或 6 位账号" value="').concat(esc2(query), '"></label><div>').concat(users.map((u) => '<article class="cloud-file" data-admin-user="'.concat(u.id, '"><div class="cloud-file-name"><b>').concat(esc2(u.name), " ").concat(u.admin ? '<small class="admin-label">管理员</small>' : "", "</b><small>LinkMe 账号 ").concat(esc2(u.number), '</small></div><div class="admin-user-actions"><button class="secondary" data-admin-edit="').concat(u.id, '">编辑资料</button><button class="secondary" data-admin-password="').concat(u.id, '" data-name="').concat(esc2(u.name), '" data-number="').concat(esc2(u.number), '">重置密码</button>').concat(u.admin ? "" : '<button class="secondary admin-delete" data-admin-delete="' + u.id + '" data-number="' + esc2(u.number) + '" data-name="' + esc2(u.name) + '">删除账号</button>', "</div></article>")).join("") || '<p class="empty-list">没有找到账号</p>', "</div></section>");
      $2("#admin-search").onkeydown = (e) => {
        if (e.key === "Enter") render(e.target.value).catch((error) => toast2(error.message));
      };
      bind("admin-create", create);
    }
    const nameField = (value = "") => '<label for="admin-name">姓名</label><input id="admin-name" maxlength="32" autocomplete="name" required placeholder="请输入姓名" value="' + esc2(value) + '">';
    function submit(formID, buttonID, save) {
      const form = $2("#" + formID), button = $2("#" + buttonID);
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (button.disabled) return;
        const name = $2("#admin-name").value.trim();
        if (!name) {
          $2("#modal-error").textContent = "请填写姓名";
          $2("#admin-name").focus();
          return;
        }
        button.disabled = true;
        $2("#modal-error").textContent = "";
        try {
          await save(name, form);
        } catch (e) {
          if (form.isConnected) {
            $2("#modal-error").textContent = e.message;
            button.disabled = false;
          } else if (e.name !== "AbortError") toast2(e.message);
        }
      };
    }
    function create() {
      modal2("注册用户账号", '<form id="admin-register-form">' + nameField() + (S2.emailAuthEnabled ? '<label for="admin-email">邮箱</label><input id="admin-email" type="email" required maxlength="254" autocomplete="off" placeholder="员工邮箱"><div class="email-code-row"><input id="admin-email-code" aria-label="验证码" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="邮箱验证码"><button type="button" id="admin-send-code" class="secondary">获取验证码</button></div>' : "") + '<label for="admin-password">初始密码（选填）</label><input id="admin-password" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="留空生成随机密码"><p class="hint">请填写姓名。邮箱为登录账号，六位 LinkMe 号用于搜索联系人。</p></form>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="admin-save-user" type="submit" form="admin-register-form">注册账号</button>');
      let challengeId = "", verifiedEmail = "";
      const send = $2("#admin-send-code");
      if (send) send.onclick = async () => {
        const input = $2("#admin-email");
        if (!input.reportValidity()) return;
        send.disabled = true;
        const email = input.value.trim().toLowerCase();
        try {
          const r = await api2("/api/admin/users/email-code", { method: "POST", body: { email, purpose: "admin-register" } });
          if (!send.isConnected) return;
          challengeId = r.challengeId;
          verifiedEmail = email;
          $2("#modal-error").textContent = "验证码已发送至员工邮箱";
          let left = r.retryAfter;
          send.textContent = left + " 秒后重发";
          const timer = setInterval(() => {
            if (!send.isConnected) {
              clearInterval(timer);
              return;
            }
            left--;
            send.textContent = left > 0 ? left + " 秒后重发" : "重新发送";
            if (left <= 0) {
              clearInterval(timer);
              send.disabled = false;
            }
          }, 1e3);
        } catch (e) {
          if (send.isConnected) {
            $2("#modal-error").textContent = e.message;
            send.disabled = false;
          }
        }
      };
      submit("admin-register-form", "admin-save-user", async (name, form) => {
        const body = { name, password: $2("#admin-password").value };
        if (S2.emailAuthEnabled) {
          body.email = $2("#admin-email").value.trim().toLowerCase();
          if (!challengeId || body.email !== verifiedEmail) throw Error("请先为当前邮箱获取验证码");
          body.challengeId = challengeId;
          body.code = $2("#admin-email-code").value;
        }
        const result = await api2("/api/admin/users", { method: "POST", body });
        if (!form.isConnected) return;
        closeModal2();
        modal2("账号已注册", "<p>姓名：" + esc2(result.user.name) + '</p><p>登录账号：<b id="admin-created-number">' + esc2(result.user.email || result.user.number) + "</b></p>" + (result.initialPassword ? '<label>随机初始密码（仅显示本次）</label><input id="admin-created-password" readonly value="' + esc2(result.initialPassword) + '">' : '<p class="hint">初始密码为刚才填写的密码。</p>'), '<button class="primary" data-action="close-modal">完成</button>');
        await refresh2();
        await render();
      });
    }
    async function edit(id) {
      modal2("编辑用户资料", '<p id="admin-profile-loading" class="hint">正在读取资料…</p>');
      const loading = $2("#admin-profile-loading");
      try {
        const u = await api2("/api/admin/users/" + id);
        if (!loading.isConnected) return;
        modal2("编辑用户资料", '<form id="admin-profile-form"><p class="hint">LinkMe 账号：' + esc2(u.number) + "</p>" + nameField(u.name) + '<label for="admin-phone">手机号</label><input id="admin-phone" type="tel" autocomplete="tel" maxlength="32" value="' + esc2(u.phone || "") + '" placeholder="未设置"><label for="admin-gender">性别</label><select id="admin-gender"><option value="">未设置</option>' + [["male", "男"], ["female", "女"], ["other", "其他"]].map(([v, t]) => '<option value="' + v + '" ' + (u.gender === v ? "selected" : "") + ">" + t + "</option>").join("") + '</select><label for="admin-job">职位</label><input id="admin-job" maxlength="64" value="' + esc2(u.jobTitle || "") + '" placeholder="未设置"><label for="admin-bio">个性签名</label><input id="admin-bio" maxlength="150" value="' + esc2(u.bio || "") + '" placeholder="未设置"></form>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="admin-save-profile" type="submit" form="admin-profile-form">保存</button>');
        submit("admin-profile-form", "admin-save-profile", async (name, form) => {
          var _a;
          const body = { name, phone: $2("#admin-phone").value, gender: $2("#admin-gender").value, jobTitle: $2("#admin-job").value, bio: $2("#admin-bio").value };
          const updated = await api2("/api/admin/users/" + id, { method: "PATCH", body });
          if (updated.id === ((_a = S2.user) == null ? void 0 : _a.id)) S2.user = __spreadValues(__spreadValues({}, S2.user), updated);
          if (form.isConnected) closeModal2();
          await refresh2();
          await render();
          toast2("资料已保存");
        });
      } catch (e) {
        if (loading.isConnected) $2("#modal-error").textContent = e.message;
      }
    }
    document.addEventListener("click", (event) => {
      var _a;
      if (!((_a = S2.policy) == null ? void 0 : _a.admin)) return;
      const editButton = event.target.closest("[data-admin-edit]");
      if (editButton) {
        edit(editButton.dataset.adminEdit);
        return;
      }
      const reset = event.target.closest("[data-admin-password]");
      if (reset) {
        modal2("重置用户密码", "<p>为 " + esc2(reset.dataset.name) + "（" + esc2(reset.dataset.number) + '）设置新密码</p><label>新密码</label><input id="admin-new-password" type="password" autocomplete="new-password" maxlength="72"><p class="hint">不需要原密码。该用户的其他登录设备将退出。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="admin-reset-password">重置密码</button>');
        bind("admin-reset-password", async () => {
          await api2("/api/admin/users/" + reset.dataset.adminPassword + "/password", { method: "POST", body: { password: $2("#admin-new-password").value } });
          closeModal2();
          toast2("密码已重置");
        });
        return;
      }
      const b = event.target.closest("[data-admin-delete]");
      if (!b) return;
      const id = b.dataset.adminDelete, number = b.dataset.number;
      modal2("删除用户账号", "<p>确认删除 <b>".concat(esc2(b.dataset.name), "</b>（").concat(esc2(number), '）？</p><p class="hint">账号将无法登录，个人网盘、空间及分享会被清除。其他用户的已有聊天记录保留，发送人显示为已注销用户。</p><label>输入该用户的 LinkMe 号码确认</label><input id="admin-confirm-number" autocomplete="off" inputmode="numeric">'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary danger" id="admin-confirm-delete">删除账号</button>');
      bind("admin-confirm-delete", async () => {
        await api2("/api/admin/users/" + id, { method: "DELETE", body: { confirmNumber: $2("#admin-confirm-number").value } });
        closeModal2();
        toast2("账号已删除");
        await refresh2();
        await render();
      });
    });
    return { render, reset() {
      generation++;
      currentQuery = "";
    }, settingsRow: () => {
      var _a;
      return ((_a = S2.policy) == null ? void 0 : _a.admin) ? '<button class="utility-row" data-nav="admin"><div class="body">管理员 · 账号管理</div>' + icon2("chevron") + "</button>" : "";
    } };
  }

  // internal/ui/src/transfers.js
  function createTransfers({ S: S2, api: api2, esc: esc2, av: av2, bytes: bytes2, randomID: randomID2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, toast: toast2 }) {
    let generation = 0, entries = [];
    const requests = /* @__PURE__ */ new Set();
    const active = (owner2, g) => S2.user && S2.token === owner2 && generation === g && !S2.signingOut;
    function stop() {
      generation++;
      for (const xhr of requests) xhr.abort();
      requests.clear();
      entries = [];
    }
    function upload2(path, file, fields = {}, onProgress = () => {
    }) {
      const owner2 = S2.token, g = generation;
      if (!S2.user) return Promise.reject(Error("请先登录"));
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(), form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
        form.append("file", file, file.name);
        requests.add(xhr);
        const finish = (error, result) => {
          requests.delete(xhr);
          if (error) reject(error);
          else if (!active(owner2, g)) reject(Object.assign(Error("账号已切换"), { name: "AbortError" }));
          else resolve(result);
        };
        xhr.open("POST", path);
        xhr.setRequestHeader("Authorization", "Bearer " + owner2);
        xhr.upload.onprogress = (e) => {
          if (active(owner2, g)) onProgress(e.lengthComputable ? Math.min(99, Math.floor(e.loaded / e.total * 100)) : null);
        };
        xhr.onload = () => {
          let result;
          try {
            result = JSON.parse(xhr.responseText);
          } catch (e) {
            return finish(Error("上传响应无效"));
          }
          if (xhr.status < 200 || xhr.status >= 300) return finish(Object.assign(Error(result.error || "上传失败"), { status: xhr.status }));
          onProgress(100);
          finish(null, result);
        };
        xhr.onerror = () => finish(Error("上传连接中断，请重新选择文件重试"));
        xhr.onabort = () => finish(Object.assign(Error("上传已取消"), { name: "AbortError" }));
        xhr.send(form);
      });
    }
    async function chat(cid, body, file, metadata2 = {}) {
      const owner2 = S2.token, g = generation, id = randomID2(), entry = { id, cid, name: file.name, size: file.size, progress: 0 };
      entries.push(entry);
      renderMessages2(true);
      try {
        const attachment = await upload2("/api/files", file, __spreadValues(__spreadValues({ conversationId: cid, clientId: id }, ["voice", "video"].includes(body.kind) ? { mediaKind: body.kind } : {}), metadata2), (percent) => {
          entry.progress = percent;
          renderMessages2(true);
        });
        if (!active(owner2, g)) return;
        const payload = __spreadProps(__spreadValues({}, body), { clientId: id, attachmentId: attachment.id });
        if (payload.kind === "auto") payload.kind = /^image\/(png|jpeg|gif|webp)$/.test(attachment.mime) ? "image" : "file";
        const message = await api2("/api/conversations/" + cid + "/messages", { method: "POST", body: payload });
        if (!active(owner2, g)) return;
        if (S2.active === cid && !S2.historyMode && !S2.messages.some((m) => m.id === message.id)) S2.messages.push(message);
        queueRefresh2(true);
      } catch (error) {
        if (active(owner2, g) && error.name !== "AbortError") {
          entry.error = error.message;
          toast2(error.message);
          throw error;
        }
      } finally {
        if (active(owner2, g)) {
          if (!entry.error) entries = entries.filter((x) => x !== entry);
          renderMessages2(true);
        }
      }
    }
    function html(cid) {
      return entries.filter((e) => e.cid === cid).map((e) => '<article class="message mine pending-message">'.concat(av2(S2.user), '<div class="message-body"><div class="bubble"><b>').concat(esc2(e.name), "</b><small>").concat(bytes2(e.size), '</small></div><div class="outbox-status">').concat(e.error ? esc2(e.error) : e.progress === 100 ? "正在生成消息…" : "正在上传 " + (e.progress === null ? "" : e.progress + "%"), "</div><small>大文件直接上传，请保持客户端运行</small></div></article>")).join("");
    }
    return { upload: upload2, chat, html, stop };
  }

  // internal/ui/src/calls.js
  function createCalls({ S: S2, api: api2, action: action2, esc: esc2, av: av2, icon: icon2, toast: toast2, modal: modal2, closeModal: closeModal2, randomID: randomID2, Meetings: Meetings2, Desktop: Desktop2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, fullTime: fullTime2 }) {
    const $2 = (s) => document.querySelector(s);
    let active = null, scope = "", generation = 0, refreshTimer2, clock, ringTimer, audio, joining = "", dialing = false, history = null, closingTask = null;
    const permitted = /* @__PURE__ */ new Set(), seen = /* @__PURE__ */ new Set(), dismissed = /* @__PURE__ */ new Set();
    const identity = () => {
      var _a;
      return JSON.stringify([S2.config.server, S2.config.fingerprint, (_a = S2.user) == null ? void 0 : _a.id, S2.token]);
    };
    const live = (g) => g === generation && scope === identity() && S2.user && !S2.signingOut;
    const reasons = { busy: "对方忙线", rejected: "已拒绝", cancelled: "已取消", no_answer: "无人接听", failed: "未能接通", completed: "通话结束", offline: "设备已离线", unavailable: "好友关系已变化", interrupted: "通话中断", disconnected: "连接已断开", expired: "通话已到时限" };
    const duration = (n) => Math.floor(Math.max(0, n) / 60).toString().padStart(2, "0") + ":" + (Math.floor(Math.max(0, n)) % 60).toString().padStart(2, "0");
    function description(c) {
      var _a;
      if (c.state === "ringing") return c.caller === ((_a = S2.user) == null ? void 0 : _a.id) ? "正在等待对方接听…" : "邀请你" + (c.mode === "video" ? "视频" : "语音") + "通话";
      if (c.state === "connecting") return "正在连接…";
      if (c.state === "connected") return duration((Date.now() - c.started) / 1e3);
      return c.started ? duration((c.ended - c.started) / 1e3) : reasons[c.reason] || "通话已结束";
    }
    function summary(value) {
      let c = value;
      try {
        if (value.kind) c = JSON.parse(value.text);
      } catch (e) {
        return "[通话]";
      }
      return "[" + (c.mode === "video" ? "视频" : "语音") + "通话] " + (c.state === "ended" ? c.started ? duration((c.ended - c.started) / 1e3) : reasons[c.reason] || "已结束" : c.state === "ringing" ? "等待接听" : c.state === "connecting" ? "正在连接" : "通话中");
    }
    function card(m) {
      let c;
      try {
        c = JSON.parse(m.text);
      } catch (e) {
        return esc2("[通话]");
      }
      ;
      return '<button class="call-message-card" data-call-redial="'.concat(esc2(m.conversationId || ""), '" data-call-mode="').concat(c.mode === "video" ? "video" : "audio", '">').concat(icon2(c.mode === "video" ? "video" : "phone"), "<span>").concat(esc2(summary(c)), "</span></button>");
    }
    function stopRing() {
      var _a, _b;
      clearInterval(ringTimer);
      ringTimer = null;
      (_b = (_a = window.WeLinkAndroid) == null ? void 0 : _a.stopCallRinging) == null ? void 0 : _b.call(_a);
      if (audio) {
        audio.close().catch(() => {
        });
        audio = null;
      }
    }
    function startRing(incoming) {
      var _a;
      if (ringTimer) return;
      if (S2.config.platform === "windows" && typeof window.welinkTakeNativeInviteAction === "function") {
        ringTimer = setInterval(() => {
        }, 6e4);
        return;
      }
      if ((_a = window.WeLinkAndroid) == null ? void 0 : _a.callRinging) {
        window.WeLinkAndroid.callRinging(incoming);
        ringTimer = setInterval(() => {
        }, 6e4);
        return;
      }
      try {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        const tone = () => {
          if (!audio) return;
          for (let i = 0; i < 2; i++) {
            const oscillator = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * 0.32;
            oscillator.frequency.value = incoming ? 660 : 440;
            gain.gain.setValueAtTime(0.025, at);
            gain.gain.exponentialRampToValueAtTime(1e-3, at + 0.22);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start(at);
            oscillator.stop(at + 0.23);
          }
        };
        audio.resume().catch(() => {
        });
        tone();
        ringTimer = setInterval(tone, incoming ? 2200 : 3200);
      } catch (e) {
      }
    }
    function layer() {
      let n = $2("#call-layer");
      if (!n) {
        n = document.createElement("div");
        n.id = "call-layer";
        document.body.append(n);
      }
      return n;
    }
    function render() {
      var _a, _b, _c;
      if (!active) {
        (_a = $2("#call-layer")) == null ? void 0 : _a.remove();
        return;
      }
      if (S2.config.platform === "windows" && typeof window.welinkTakeNativeInviteAction === "function") {
        (_b = $2("#call-layer")) == null ? void 0 : _b.remove();
        return;
      }
      if (active.state === "ended" || joining === active.id || dismissed.has(active.id)) {
        (_c = $2("#call-layer")) == null ? void 0 : _c.remove();
        return;
      }
      const c = active, incoming = c.canRespond, other = !incoming && !c.canEnd;
      layer().innerHTML = '<section class="call-dialog" role="dialog" aria-label="'.concat(incoming ? "来电" : "通话", '"><header><b>LinkMe · ').concat(c.mode === "video" ? "视频" : "语音", '通话</b><button data-call-minimize title="收起">').concat(icon2("minus"), '</button></header><div class="call-person">').concat(av2(c.peer, "large"), "<h2>").concat(esc2(c.peer.name), '</h2><p class="call-status" role="status">').concat(other ? "已在其他设备接听" : esc2(description(c)), '</p></div><div class="call-buttons">').concat(incoming ? '<button class="call-decline" data-call-reject>'.concat(icon2("phone"), "<span>拒绝</span></button>").concat(c.mode === "video" ? '<button class="call-audio-answer" data-call-answer="audio">' + icon2("phone") + "<span>语音接听</span></button>" : "", '<button class="call-answer" data-call-answer="').concat(c.mode, '">').concat(icon2(c.mode === "video" ? "video" : "phone"), "<span>接听</span></button>") : c.canJoin ? '<button class="call-answer" data-call-resume>' + icon2("phone") + "<span>继续通话</span></button>" : "").concat(c.canEnd ? '<button class="call-decline" data-call-end>' + icon2("phone") + "<span>" + (c.state === "ringing" ? "取消" : "挂断") + "</span></button>" : "").concat(other ? '<button class="secondary" data-call-dismiss>知道了</button>' : "", '</div></section><button class="call-mini" data-call-expand>').concat(icon2("phone"), "<span>").concat(esc2(c.peer.name), " · ").concat(esc2(description(c)), "</span></button>");
    }
    async function refreshConversation(c, g) {
      if (S2.active !== c.conversationId || S2.historyMode) return;
      const messages = await api2("/api/conversations/" + c.conversationId + "/messages");
      if (live(g) && S2.active === c.conversationId && !S2.historyMode) {
        S2.messages = messages;
        renderMessages2(true);
      }
    }
    async function apply(c, g = generation) {
      var _a;
      if (!live(g) || c.state !== "ended" && seen.has(c.id)) return;
      if ((active == null ? void 0 : active.id) === c.id && active.revision > c.revision) return;
      const missed = c.state === "ended" && c.started === 0 && c.callee === ((_a = S2.user) == null ? void 0 : _a.id) && ["no_answer", "offline", "interrupted"].includes(c.reason);
      Desktop2 == null ? void 0 : Desktop2.activity("call/" + c.id, c.state === "ringing" && c.canRespond || missed);
      if (c.state === "ended") {
        if ((active == null ? void 0 : active.id) === c.id) {
          active = null;
          joining = "";
          stopRing();
          render();
          Meetings2.closeCall(c.id);
        }
        if (!seen.has(c.id) && permitted.has(c.id)) toast2(description(c));
        permitted.delete(c.id);
        seen.add(c.id);
        refreshConversation(c, g).catch(() => {
        });
        queueRefresh2();
        if (history) loadHistory().catch(() => {
        });
        return;
      }
      if (active && active.id !== c.id) return;
      const updated = (active == null ? void 0 : active.revision) !== c.revision;
      active = c;
      if (updated) {
        const message = S2.messages.find((m) => m.id === c.messageId && !m.recalled);
        if (message) {
          message.text = JSON.stringify({ id: c.id, mode: c.mode, state: c.state, reason: c.reason, started: c.started, ended: c.ended });
          const span = document.querySelector('[data-message="'.concat(c.messageId, '"] .call-message-card span'));
          if (span) span.textContent = summary(c);
        }
        queueRefresh2();
      }
      render();
      if (c.state === "ringing" && (c.canRespond || c.canEnd)) {
        startRing(c.canRespond);
      } else stopRing();
      if (c.canJoin && permitted.has(c.id) && joining !== c.id) {
        joining = c.id;
        render();
        try {
          await Meetings2.joinCall(c);
        } catch (error) {
          if (live(g)) {
            joining = "";
            toast2("无法开启通话：" + error.message);
            try {
              await action2("/api/calls/" + c.id + "/end");
            } catch (e) {
            }
            await sync();
          }
        }
      }
    }
    async function sync() {
      const g = generation;
      if (!S2.user || !scope) return;
      try {
        const calls = await api2("/api/calls/active");
        if (!live(g)) return;
        for (const c of calls) await apply(c, g);
        if (active && !calls.some((c) => c.id === active.id)) {
          const old = active;
          await changed({ id: old.id });
        }
      } catch (e) {
      } finally {
        if (live(g)) {
          clearTimeout(refreshTimer2);
          refreshTimer2 = setTimeout(sync, active ? 1500 : 5e3);
        }
      }
    }
    async function changed(event) {
      const g = generation;
      if (!scope) return;
      try {
        const c = await api2("/api/calls/" + event.id);
        if (live(g)) await apply(c, g);
      } catch (e) {
      }
    }
    function start() {
      stop();
      scope = identity();
      clock = setInterval(() => {
        if (active) {
          const node = $2(".call-status");
          if (node && active.state === "connected") node.textContent = description(active);
          const mini = $2(".call-mini span");
          if (mini) mini.textContent = active.peer.name + " · " + description(active);
        }
      }, 1e3);
      sync();
    }
    function stop() {
      var _a;
      generation++;
      scope = "";
      clearTimeout(refreshTimer2);
      clearInterval(clock);
      stopRing();
      const closing = active == null ? void 0 : active.id;
      active = null;
      if (closing) Meetings2.closeCall(closing);
      joining = "";
      dialing = false;
      closingTask = null;
      permitted.clear();
      seen.clear();
      dismissed.clear();
      history = null;
      (_a = $2("#call-layer")) == null ? void 0 : _a.remove();
    }
    async function dial(cid, mode) {
      if (dialing) return;
      const g = generation;
      dialing = true;
      try {
        if (closingTask) await closingTask;
        if (!live(g)) return;
        if (active || Meetings2.busy()) {
          toast2("请先结束当前通话或会议");
          return;
        }
        const c = await action2("/api/calls", { conversationId: cid, mode, clientId: randomID2() });
        if (!live(g)) return;
        permitted.add(c.id);
        await apply(c, g);
      } catch (error) {
        if (live(g)) {
          toast2(error.message);
          sync();
        }
      } finally {
        if (live(g)) dialing = false;
      }
    }
    async function answer(audioOnly = false) {
      if (!(active == null ? void 0 : active.canRespond)) return;
      const c = active, g = generation;
      permitted.add(c.id);
      stopRing();
      try {
        const result = await action2("/api/calls/" + c.id + "/respond", { accept: true, audioOnly });
        if (live(g)) await apply(result, g);
      } catch (error) {
        permitted.delete(c.id);
        if (live(g)) {
          toast2(error.message);
          await changed(c);
        }
      }
    }
    async function end(reject = false) {
      const c = active;
      if (!c) return;
      const g = generation;
      stopRing();
      try {
        const result = await action2("/api/calls/" + c.id + (reject ? "/respond" : "/end"), reject ? { accept: false } : {});
        if (live(g)) await apply(result, g);
      } catch (error) {
        if (live(g)) {
          toast2(error.message);
          await changed(c);
        }
      }
    }
    async function mediaClosed(id) {
      Meetings2.closedNativeCall(id);
      if (joining === id) joining = "";
      if ((active == null ? void 0 : active.id) !== id) return;
      const g = generation;
      active = null;
      seen.add(id);
      stopRing();
      render();
      const task = (async () => {
        try {
          await action2("/api/calls/" + id + "/end");
        } catch (e) {
        }
        if (live(g)) await sync();
      })();
      closingTask = task;
      try {
        await task;
      } finally {
        if (closingTask === task) closingTask = null;
      }
    }
    function historyRow(c) {
      return '<article class="call-history-row" data-call-record="'.concat(c.id, '">').concat(av2(c.peer), "<div><b>").concat(esc2(c.peer.name), '</b><p class="').concat(c.started === 0 && c.callee === S2.user.id ? "call-missed" : "", '">').concat(c.caller === S2.user.id ? "呼出" : "呼入", " · ").concat(esc2(summary(c)), "</p><small>").concat(esc2(fullTime2(c.created)), '</small></div><button title="再次呼叫" aria-label="再次呼叫" data-call-redial="').concat(c.conversationId, '" data-call-mode="').concat(c.mode, '">').concat(icon2(c.mode === "video" ? "video" : "phone"), '</button><button title="删除通话记录" aria-label="删除通话记录" data-call-delete="').concat(c.id, '">').concat(icon2("trash"), "</button></article>");
    }
    async function loadHistory(older = false) {
      const h = history, g = generation;
      if (!h || !$2("#call-history-list")) return;
      const query = new URLSearchParams();
      if (h.missed) query.set("missed", "true");
      if (older && h.items.length) query.set("before", String(h.items[h.items.length - 1].seq));
      const items = await api2("/api/calls/history?" + query);
      if (history !== h || !live(g) || !$2("#call-history-list")) return;
      h.items = older ? [...h.items, ...items] : items;
      $2("#call-history-list").innerHTML = h.items.map(historyRow).join("") || '<div class="empty-list">暂无通话记录</div>';
      if (items.length === 50) $2("#call-history-list").insertAdjacentHTML("beforeend", '<button class="secondary" data-call-more>加载更多</button>');
    }
    function openHistory() {
      Desktop2 == null ? void 0 : Desktop2.clearActivities("call/");
      history = { missed: false, items: [] };
      modal2("通话记录", '<div class="call-history-tabs"><button class="active" data-call-filter="all">全部</button><button data-call-filter="missed">未接来电</button></div><div id="call-history-list"></div>', "", true);
      loadHistory().catch((e) => toast2(e.message));
    }
    document.addEventListener("click", async (event) => {
      var _a;
      const b = event.target.closest("[data-call-mode],[data-call-answer],[data-call-end],[data-call-reject],[data-call-resume],[data-call-minimize],[data-call-expand],[data-call-dismiss],[data-call-history],[data-call-delete],[data-call-filter],[data-call-more]");
      if (!b) return;
      try {
        if (b.dataset.callMode) {
          closeModal2();
          await dial(b.dataset.callRedial || S2.active, b.dataset.callMode);
        } else if (b.dataset.callAnswer) await answer(b.dataset.callAnswer === "audio");
        else if (b.hasAttribute("data-call-end")) await end();
        else if (b.hasAttribute("data-call-reject")) await end(true);
        else if (b.hasAttribute("data-call-resume") && active) {
          permitted.add(active.id);
          await apply(active);
        } else if (b.hasAttribute("data-call-minimize")) layer().classList.add("call-minimized");
        else if (b.hasAttribute("data-call-expand")) layer().classList.remove("call-minimized");
        else if (b.hasAttribute("data-call-dismiss")) {
          if (active) dismissed.add(active.id);
          (_a = $2("#call-layer")) == null ? void 0 : _a.remove();
        } else if (b.hasAttribute("data-call-history")) openHistory();
        else if (b.dataset.callFilter) {
          history = { missed: b.dataset.callFilter === "missed", items: [] };
          document.querySelectorAll("[data-call-filter]").forEach((x) => x.classList.toggle("active", x === b));
          await loadHistory();
        } else if (b.hasAttribute("data-call-more")) await loadHistory(true);
        else if (b.dataset.callDelete) {
          const id = b.dataset.callDelete;
          modal2("删除通话记录", '<p class="hint">仅删除你的通话列表记录，聊天中的记录卡片保留。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="call-delete-confirm">删除</button>');
          $2("#call-delete-confirm").onclick = async () => {
            try {
              await api2("/api/calls/" + id, { method: "DELETE" });
              openHistory();
            } catch (error) {
              toast2(error.message);
            }
          };
        }
      } catch (error) {
        toast2(error.message);
      }
    });
    window.WeLinkCallNativeClosed = (id) => mediaClosed(id);
    async function nativeAction(id, accept) {
      await changed({ id });
      if ((active == null ? void 0 : active.id) !== id) return;
      if (accept) await answer(false);
      else await end(true);
    }
    return { dial, start, stop, changed, sync, card, summary, mediaClosed, nativeAction, isCurrent: (id) => (active == null ? void 0 : active.id) === id && active.canJoin, historyChanged: () => {
      if (history) loadHistory().catch(() => {
      });
    }, historyEntry: () => '<button class="call-history-entry" data-call-history>' + icon2("phone") + "<span>通话记录</span>" + icon2("chevron") + "</button>" };
  }

  // internal/ui/src/desktop.js
  function createDesktop({ S: S2, modal: modal2, closeModal: closeModal2, toast: toast2, markRead: markRead2, esc: esc2 }) {
    const native = typeof window.welinkDesktopSettings === "function";
    let lastCount = -1, nativeHidden = !!window.welinkNativeHidden;
    const hidden = () => document.hidden || nativeHidden || !document.hasFocus();
    function unread() {
      if (!native) return;
      const count = S2.user ? S2.conversations.reduce((n, c) => n + Number((c.muted ? c.mentionCount : c.unread) || 0), 0) : 0;
      lastCount = count;
      window.welinkDesktopUnread(count).catch(() => {
        lastCount = -1;
      });
    }
    function activity(key, active) {
      if (!native) return;
      window.welinkDesktopActivity(key, !!active).catch(() => {
      });
    }
    function clearActivities(prefix = "") {
      if (!native) return;
      window.welinkDesktopClearActivities(prefix).catch(() => {
      });
    }
    async function settings2() {
      var _a, _b, _c, _d, _e, _f;
      try {
        const p = await window.welinkDesktopSettings();
        const toggle = (id, label, checked) => '<label class="prefs-row" for="'.concat(id, '"><span>').concat(label, '</span><input id="').concat(id, '" type="checkbox" ').concat(checked ? "checked" : "", "></label>");
        const shortcut = (id, label, value, error) => '<label class="prefs-row desktop-shortcut" for="'.concat(id, '"><span>').concat(label, '</span><span class="shortcut-control"><input id="').concat(id, '" class="shortcut-input" readonly value="').concat(esc2(value || ""), '" placeholder="点击后按下快捷键" aria-label="').concat(label, '快捷键"><button class="secondary" type="button" data-clear-shortcut="').concat(id, '">清除</button></span></label>').concat(error ? '<p class="shortcut-error" data-shortcut-error="' + id + '">' + esc2(error) + "</p>" : "");
        modal2("Windows 桌面设置", toggle("desktop-auto-start", "登录 Windows 后启动 LinkMe", p.autoStart) + toggle("desktop-start-minimized", "开机启动时最小化到托盘", (_a = p.startMinimized) != null ? _a : true) + '<p class="hint">仅对当前 Windows 用户生效，默认关闭。'.concat(p.autoStart && !p.autoStartRegistered ? "启动项尚未注册，请重新保存。" : "", "</p>") + toggle("desktop-close-tray", "关闭窗口后留在系统托盘", p.closeToTray) + '<p class="hint">关闭窗口后继续接收消息，双击托盘图标即可恢复。</p><p class="hint">普通聊天只通过任务栏图标提示未读；来电、远程和会议邀请会在右下角显示。</p>' + toggle("desktop-hotkeys-enabled", "启用全局快捷键", (_b = p.hotkeysEnabled) != null ? _b : true) + shortcut("desktop-show-hotkey", "显示主界面", (_c = p.showHotkey) != null ? _c : "Ctrl+Alt+W", (_d = p.hotkeyErrors) == null ? void 0 : _d.show) + shortcut("desktop-capture-hotkey", "截图", (_e = p.captureHotkey) != null ? _e : "Ctrl+Alt+A", (_f = p.hotkeyErrors) == null ? void 0 : _f.capture) + '<p class="hint">点击输入框后按下组合键，须包含 Ctrl 或 Alt。可清除某一项；被 QQ 等其他程序占用时可换一个组合键。</p>' + (p.trayAvailable ? "" : '<p class="hint">系统托盘暂不可用，关闭窗口时会最小化到任务栏。</p>') + '<p class="hint">完全退出可使用托盘右键菜单中的“退出 LinkMe”。</p><p id="desktop-save-error" class="shortcut-error" role="alert"></p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="desktop-save">保存</button>');
        document.querySelector(".modal").classList.add("desktop-settings");
        const $2 = (id) => document.getElementById(id), availability = () => {
          $2("desktop-start-minimized").disabled = !$2("desktop-auto-start").checked;
          for (const input of document.querySelectorAll(".shortcut-input")) input.disabled = !$2("desktop-hotkeys-enabled").checked;
          for (const b of document.querySelectorAll("[data-clear-shortcut]")) b.disabled = !$2("desktop-hotkeys-enabled").checked;
        };
        $2("desktop-auto-start").onchange = availability;
        $2("desktop-hotkeys-enabled").onchange = availability;
        availability();
        for (const input of document.querySelectorAll(".shortcut-input")) input.onkeydown = (event) => {
          var _a2;
          if (event.key === "Tab") return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            input.blur();
            return;
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            input.value = "";
            return;
          }
          if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
          const code = event.code || "", key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d+$/.test(event.key) ? event.key : "";
          if (event.metaKey || !event.ctrlKey && !event.altKey || !key || key === "F12") {
            $2("desktop-save-error").textContent = "请选择 Ctrl / Alt 与字母、数字或功能键的组合，F12 不可用。";
            return;
          }
          (_a2 = document.querySelector('[data-shortcut-error="' + input.id + '"]')) == null ? void 0 : _a2.remove();
          input.value = [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
          $2("desktop-save-error").textContent = "";
        };
        for (const button2 of document.querySelectorAll("[data-clear-shortcut]")) button2.onclick = () => {
          var _a2;
          $2(button2.dataset.clearShortcut).value = "";
          (_a2 = document.querySelector('[data-shortcut-error="' + button2.dataset.clearShortcut + '"]')) == null ? void 0 : _a2.remove();
        };
        const button = $2("desktop-save");
        button.onclick = async () => {
          button.disabled = true;
          try {
            await window.welinkDesktopSave({ closeToTray: $2("desktop-close-tray").checked, messageAlerts: false, messageSound: p.messageSound !== false, autoStart: $2("desktop-auto-start").checked, startMinimized: $2("desktop-start-minimized").checked, hotkeysEnabled: $2("desktop-hotkeys-enabled").checked, showHotkey: $2("desktop-show-hotkey").value, captureHotkey: $2("desktop-capture-hotkey").value });
            closeModal2();
            toast2("桌面设置已保存");
          } catch (error) {
            $2("desktop-save-error").textContent = String(error);
            button.disabled = false;
          }
        };
      } catch (error) {
        toast2(String(error));
      }
    }
    function quit() {
      modal2("退出 LinkMe", "<p>退出后将停止接收消息，并结束当前通话和远程协助。</p>", '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="desktop-exit">退出</button>');
      document.querySelector("#desktop-exit").onclick = () => window.welinkDesktopExit();
    }
    window.addEventListener("welink-native-visibility", (event) => {
      var _a;
      nativeHidden = !!((_a = event.detail) == null ? void 0 : _a.hidden);
      if (!hidden() && S2.user) {
        document.title = "LinkMe";
        markRead2().catch(() => {
        });
      }
    });
    document.addEventListener("click", (event) => {
      var _a;
      if (!native) return;
      const action2 = (_a = event.target.closest("[data-desktop]")) == null ? void 0 : _a.dataset.desktop;
      if (action2 === "settings") settings2();
      if (action2 === "quit") quit();
    });
    return { native, hidden, unread, activity, clearActivities, settingsRow: () => native ? '<div class="prefs-row"><span>Windows 桌面设置</span><button class="secondary" data-desktop="settings">管理</button></div>' : "", exitMenu: () => native ? '<button data-desktop="quit">退出 LinkMe</button>' : "" };
  }

  // internal/ui/src/screenshots.js
  function createScreenshots({ S: S2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, upload: upload2 }) {
    let pending = null, editor = null, generation = 0, stream = null;
    const own = (state) => editor === state && state.canvas.isConnected;
    function reset() {
      var _a, _b;
      generation++;
      pending = null;
      stream == null ? void 0 : stream.getTracks().forEach((track) => track.stop());
      stream = null;
      if (editor) {
        (_a = editor.observer) == null ? void 0 : _a.disconnect();
        cancelAnimationFrame(editor.frame);
        editor.image.src = "";
        editor.canvas.width = editor.canvas.height = 1;
        editor = null;
      }
      (_b = window.welinkScreenshotCancel) == null ? void 0 : _b.call(window).catch(() => {
      });
    }
    async function start() {
      var _a, _b;
      if (pending || editor) return;
      const state = pending = { token: S2.token, cid: S2.user && S2.active && S2.tab === "messages" ? S2.active : null, name: ((_a = S2.conversations.find((c) => c.id === S2.active)) == null ? void 0 : _a.name) || "" }, version = generation;
      if (typeof window.welinkScreenshotCapture === "function") {
        try {
          if (await window.welinkScreenshotCapture() === false) {
            pending = null;
            toast2("截图仍在处理中，请稍后重试");
          }
        } catch (error) {
          pending = null;
          toast2(String(error));
        }
        return;
      }
      if (!((_b = navigator.mediaDevices) == null ? void 0 : _b.getDisplayMedia)) {
        pending = null;
        toast2("此设备请使用系统截图后发送图片");
        return;
      }
      let captureStream;
      try {
        captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        if (version !== generation) return;
        stream = captureStream;
        const video = document.createElement("video");
        video.srcObject = captureStream;
        await video.play();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (version !== generation) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const image = canvas.toDataURL("image/png");
        canvas.width = canvas.height = 1;
        video.srcObject = null;
        if (version === generation && pending === state) await preview2(state, image);
      } catch (error) {
        if (version === generation && error.name !== "NotAllowedError") toast2("截图失败：" + error.message);
      } finally {
        captureStream == null ? void 0 : captureStream.getTracks().forEach((track) => track.stop());
        if (stream === captureStream) stream = null;
        if (pending === state) pending = null;
      }
    }
    function redraw(state) {
      if (!own(state)) return;
      const { canvas, ctx, image } = state;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      for (const item of [...state.items, ...state.current ? [state.current] : []]) {
        ctx.strokeStyle = ctx.fillStyle = item.color;
        ctx.lineWidth = item.width;
        ctx.lineCap = ctx.lineJoin = "round";
        const [a, b] = item.points;
        if (item.tool === "pen") {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (const point of item.points.slice(1)) ctx.lineTo(point.x, point.y);
          if (item.points.length === 1) ctx.lineTo(a.x + 0.1, a.y + 0.1);
          ctx.stroke();
        } else if (item.tool === "text") {
          ctx.font = "".concat(Math.max(18, item.width * 6), 'px "Microsoft YaHei",sans-serif');
          ctx.textBaseline = "top";
          ctx.fillText(item.text, a.x, a.y);
        } else if (b) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
          if (item.tool === "rectangle") ctx.strokeRect(x, y, w, h);
          if (item.tool === "arrow") {
            const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.max(12, item.width * 4);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.moveTo(b.x - length * Math.cos(angle - 0.5), b.y - length * Math.sin(angle - 0.5));
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(b.x - length * Math.cos(angle + 0.5), b.y - length * Math.sin(angle + 0.5));
            ctx.stroke();
          }
          if (item.tool === "mosaic" && w >= 1 && h >= 1) {
            const small = document.createElement("canvas"), size = Math.max(8, item.width * 5);
            small.width = Math.max(1, Math.ceil(w / size));
            small.height = Math.max(1, Math.ceil(h / size));
            small.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(small, x, y, w, h);
            ctx.imageSmoothingEnabled = true;
            small.width = small.height = 1;
          }
        }
      }
      document.querySelector("#screenshot-undo").disabled = !state.items.length;
      document.querySelector("#screenshot-clear").disabled = !state.items.length;
    }
    function paint(state) {
      cancelAnimationFrame(state.frame);
      state.frame = requestAnimationFrame(() => redraw(state));
    }
    async function blob(state) {
      if (!own(state)) throw Error("截图预览已关闭");
      redraw(state);
      const result = await new Promise((resolve) => state.canvas.toBlob(resolve, "image/png"));
      if (!result) throw Error("无法生成截图");
      if (!own(state)) throw Error("截图预览已关闭");
      return result;
    }
    async function preview2(intent, url) {
      intent.loading = true;
      const version = generation, image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error("无法读取截图"));
        image.src = url;
      });
      if (version !== generation) return;
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024) throw Error("截图尺寸过大");
      pending = null;
      const canSend = !!intent.cid && !!S2.user && S2.token === intent.token;
      modal2(
        "截图预览",
        '<div class="screenshot-tools" role="toolbar" aria-label="截图标注">'.concat([["pen", "画笔"], ["rectangle", "矩形"], ["arrow", "箭头"], ["text", "文字"], ["mosaic", "马赛克"]].map(([tool, label]) => '<button type="button" data-shot-tool="'.concat(tool, '" class="').concat(tool === "pen" ? "selected" : "", '" aria-pressed="').concat(tool === "pen", '">').concat(label, "</button>")).join(""), '<label>颜色<input id="screenshot-color" type="color" value="#ff5454" aria-label="标注颜色"></label><label>粗细<select id="screenshot-width" aria-label="标注粗细"><option value="2">细</option><option value="4" selected>中</option><option value="8">粗</option></select></label><button id="screenshot-undo" type="button">撤销</button><button id="screenshot-clear" type="button">清空标注</button></div><div class="screenshot-canvas-wrap"><canvas id="screenshot-canvas" aria-label="截图标注画布"></canvas></div><div class="screenshot-text-row hidden"><input id="screenshot-text" maxlength="200" placeholder="输入标注文字后，点击图中要放置的位置" aria-label="截图标注文字"></div><p class="hint">').concat(image.naturalWidth, " × ").concat(image.naturalHeight, " · ").concat(canSend ? "确认后发送给 " + esc2(intent.name) : "可保存到电脑或复制到剪贴板", "。Esc 关闭，Ctrl + Z 撤销。</p>"),
        '<button class="secondary" data-action="close-modal">取消</button><button class="secondary" id="screenshot-save">保存图片</button><button class="secondary" id="screenshot-copy">复制</button>' + (canSend ? '<button class="primary" id="screenshot-send">发送到 ' + esc2(intent.name) + "</button>" : ""),
        true
      );
      document.querySelector(".modal").classList.add("screenshot-editor");
      const canvas = document.querySelector("#screenshot-canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const state = editor = __spreadProps(__spreadValues({}, intent), { canvas, ctx: canvas.getContext("2d"), image, items: [], current: null, tool: "pen", frame: 0, pointer: null });
      state.observer = new MutationObserver(() => {
        if (editor === state && !canvas.isConnected) reset();
      });
      state.observer.observe(document.querySelector("#overlays"), { childList: true, subtree: true });
      const position = (event) => {
        const rect = canvas.getBoundingClientRect();
        return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)) };
      };
      canvas.onpointerdown = (event) => {
        if (event.button !== 0 || state.pointer !== null) return;
        event.preventDefault();
        if (state.items.length >= 250) {
          toast2("标注数量较多，请先撤销或清空部分内容");
          return;
        }
        const item = { tool: state.tool, color: document.querySelector("#screenshot-color").value, width: Number(document.querySelector("#screenshot-width").value), points: [position(event)] };
        if (item.tool === "text") {
          item.text = document.querySelector("#screenshot-text").value.trim();
          if (!item.text) {
            document.querySelector("#screenshot-text").focus();
            return;
          }
          state.items.push(item);
          paint(state);
          return;
        }
        state.current = item;
        state.pointer = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        paint(state);
      };
      canvas.onpointermove = (event) => {
        if (state.pointer !== event.pointerId || !state.current) return;
        const point = position(event);
        if (state.current.tool === "pen") {
          if (state.current.points.length < 1e4) state.current.points.push(point);
        } else state.current.points[1] = point;
        paint(state);
      };
      const finish = (event, cancelled = false) => {
        if (state.pointer !== event.pointerId) return;
        state.pointer = null;
        if (!cancelled && state.current) state.items.push(state.current);
        state.current = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        paint(state);
      };
      canvas.onpointerup = (event) => finish(event);
      canvas.onpointercancel = (event) => finish(event, true);
      canvas.onlostpointercapture = (event) => finish(event, true);
      for (const button of document.querySelectorAll("[data-shot-tool]")) button.onclick = () => {
        state.tool = button.dataset.shotTool;
        for (const b of document.querySelectorAll("[data-shot-tool]")) {
          b.classList.toggle("selected", b === button);
          b.setAttribute("aria-pressed", String(b === button));
        }
        document.querySelector(".screenshot-text-row").classList.toggle("hidden", state.tool !== "text");
      };
      document.querySelector("#screenshot-undo").onclick = () => {
        state.items.pop();
        paint(state);
      };
      document.querySelector("#screenshot-clear").onclick = () => {
        state.items = [];
        paint(state);
      };
      const perform = (id, work) => {
        const button = document.getElementById(id);
        if (button) button.onclick = async () => {
          button.disabled = true;
          try {
            await work();
          } catch (error) {
            toast2(String(error.message || error));
          } finally {
            if (own(state)) button.disabled = false;
          }
        };
      };
      perform("screenshot-save", async () => {
        const data = await blob(state), href = URL.createObjectURL(data), link = document.createElement("a");
        link.href = href;
        link.download = "LinkMe-截图-" + Date.now() + ".png";
        link.click();
        setTimeout(() => URL.revokeObjectURL(href), 6e4);
      });
      perform("screenshot-copy", async () => {
        var _a;
        const data = await blob(state);
        if (typeof window.welinkScreenshotCopy === "function") {
          const encoded = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(data);
          });
          if (!own(state)) return;
          await window.welinkScreenshotCopy(encoded);
        } else if (((_a = navigator.clipboard) == null ? void 0 : _a.write) && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "image/png": data })]);
        else throw Error("此设备请先保存图片");
        if (own(state)) toast2("截图已复制");
      });
      perform("screenshot-send", async () => {
        if (!S2.user || S2.token !== state.token) throw Error("登录账号已变化，请重新选择聊天后截图");
        const data = await blob(state);
        if (S2.token !== state.token) throw Error("登录账号已变化");
        await upload2(new File([data], "截图-" + Date.now() + ".png", { type: "image/png" }), false, state.cid);
        if (own(state)) closeModal2();
      });
      redraw(state);
    }
    window.addEventListener("welink-screenshot-request", () => start().catch((error) => toast2(String(error))));
    window.addEventListener("welink-screenshot-result", (event) => {
      const state = pending;
      if (!state || state.loading) return;
      const result = event.detail || {};
      if (result.cancelled || result.error) {
        pending = null;
        if (result.error) toast2(result.error);
        return;
      }
      if (typeof result.image === "string" && result.image.startsWith("data:image/png;base64,")) preview2(state, result.image).catch((error) => {
        pending = null;
        toast2(String(error.message || error));
      });
    });
    document.addEventListener("keydown", (event) => {
      if (!editor || !own(editor)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModal2();
        reset();
      } else if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "z" && !event.target.closest("input")) {
        event.preventDefault();
        editor.items.pop();
        paint(editor);
      }
    }, true);
    return { start, reset };
  }

  // internal/ui/src/avatars.js
  function createAvatars({ S: S2, api: api2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, av: av2, refresh: refresh2, renderMessages: renderMessages2, renderMain: renderMain2, updateRail: updateRail2, profile: profile2, groupDetail }) {
    const $2 = (s) => document.querySelector(s);
    let current = null;
    const endpoint = (s) => s.scope === "user" ? "/api/me/avatar" : "/api/groups/" + s.target + "/avatar";
    function release() {
      var _a, _b;
      (_b = (_a = current == null ? void 0 : current.image) == null ? void 0 : _a.close) == null ? void 0 : _b.call(_a);
      current = null;
    }
    function finish(changed2 = false) {
      var _a;
      const s = current;
      if (!s) return;
      release();
      closeModal2();
      (_a = s.back) == null ? void 0 : _a.call(s, changed2);
    }
    function choose() {
      var _a;
      const s = current;
      if (!s) return;
      if (s.scope === "user") {
        chooseCartoon();
        return;
      }
      modal2(s.scope === "user" ? "个人头像" : "群头像", '<div class="avatar-selection"><div>'.concat(av2(s.info, "large"), "</div><h4>").concat(esc2(s.info.name || "更换头像"), '</h4><p>选择照片后可移动、缩放和旋转裁剪。</p><button class="primary" data-avatar="pick">选择图片</button><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden><small>最多 8 MB，4096 × 4096 像素；保存为静态头像</small>').concat(((_a = s.info.avatar) == null ? void 0 : _a.startsWith("image:")) ? '<button class="avatar-reset" data-avatar="reset">恢复默认头像</button>' : "", "</div>"), '<button class="secondary" data-avatar="cancel">返回</button>');
      $2("#avatar-file").onchange = (e) => {
        if (e.target.files[0]) load(e.target.files[0]);
      };
    }
    function chooseCartoon() {
      var _a, _b;
      const s = current;
      if (!s) return;
      s.selected = s.selected || s.info.avatar;
      s.choices = s.choices || cartoonChoices(8);
      const items = s.all ? cartoonAvatars : s.choices;
      modal2("个人头像", '<div class="cartoon-picker"><div class="cartoon-preview">'.concat(av2(__spreadProps(__spreadValues({}, s.info), { avatar: s.selected }), "large"), '<div><b>选一个喜欢的头像</b><p>100 个卡通形象，也可以上传自己的照片</p></div></div><div class="cartoon-heading"><div class="cartoon-tabs"><button data-avatar="recommended" class="').concat(s.all ? "" : "active", '">为你推荐</button><button data-avatar="all-cartoons" class="').concat(s.all ? "active" : "", '">全部 100 个</button></div><button data-avatar="shuffle">换一批</button></div><div class="cartoon-grid ').concat(s.all ? "all" : "", '" id="cartoon-options" role="radiogroup" aria-label="卡通头像">').concat(cartoonOptions(items, s.selected), '</div><div class="cartoon-upload"><button class="secondary" data-avatar="pick">上传自己的照片</button><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden><small>支持移动、缩放和旋转裁剪</small>').concat(((_a = s.info.avatar) == null ? void 0 : _a.startsWith("image:")) ? '<button class="avatar-reset" data-avatar="reset">恢复默认头像</button>' : "", "</div></div>"), '<button class="secondary" data-avatar="cancel">取消</button><button class="primary" data-avatar="save-cartoon" ' + (!((_b = s.selected) == null ? void 0 : _b.startsWith("cartoon:")) ? "disabled" : "") + ">使用这个头像</button>", true);
      $2(".modal").classList.add("cartoon-modal");
      $2("#avatar-file").onchange = (e) => {
        if (e.target.files[0]) load(e.target.files[0]);
      };
    }
    async function load(file) {
      var _a, _b, _c, _d;
      const s = current;
      if (!s) return;
      if (file.size > 8 * 1024 * 1024) {
        toast2("图片不能超过 8 MB");
        return;
      }
      let img, url;
      try {
        if (window.createImageBitmap) img = await createImageBitmap(file, { imageOrientation: "from-image" });
        else {
          url = URL.createObjectURL(file);
          img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
          });
        }
        if (current !== s) {
          (_a = img.close) == null ? void 0 : _a.call(img);
          return;
        }
        if (img.width > 4096 || img.height > 4096 || img.width * img.height > 16 * 1024 * 1024) {
          (_b = img.close) == null ? void 0 : _b.call(img);
          throw Error("请选择不超过 4096 × 4096 像素的图片");
        }
        (_d = (_c = s.image) == null ? void 0 : _c.close) == null ? void 0 : _d.call(_c);
        s.image = img;
        s.angle = 0;
        s.zoom = 1;
        s.x = s.y = 0;
        editor();
      } catch (e) {
        toast2((e == null ? void 0 : e.message) || "无法读取图片，请选择 JPEG、PNG、WebP 或 GIF");
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
    function geometry(s) {
      const rotated = s.angle % 180 !== 0, w = rotated ? s.image.height : s.image.width, h = rotated ? s.image.width : s.image.height, scale = Math.max(512 / w, 512 / h) * s.zoom;
      return { scale, wide: w * scale, tall: h * scale };
    }
    function draw() {
      const s = current, canvas = $2("#avatar-canvas");
      if (!(s == null ? void 0 : s.image) || !canvas) return;
      const g = geometry(s);
      s.x = Math.max(-(g.wide - 512) / 2, Math.min((g.wide - 512) / 2, s.x));
      s.y = Math.max(-(g.tall - 512) / 2, Math.min((g.tall - 512) / 2, s.y));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 512, 512);
      ctx.save();
      ctx.translate(256 + s.x, 256 + s.y);
      ctx.rotate(s.angle * Math.PI / 180);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(s.image, -s.image.width * g.scale / 2, -s.image.height * g.scale / 2, s.image.width * g.scale, s.image.height * g.scale);
      ctx.restore();
    }
    function editor() {
      const s = current;
      if (!s) return;
      modal2("裁剪头像", '<div id="avatar-editor"><p class="hint">拖动图片调整位置，缩放后选择头像区域</p><div class="avatar-crop-frame"><canvas id="avatar-canvas" width="512" height="512" role="img" aria-label="头像裁剪预览"></canvas><div class="avatar-crop-guide"></div></div><label class="avatar-zoom-label" for="avatar-zoom">缩放<input id="avatar-zoom" type="range" min="1" max="4" step="0.01" value="1"></label><div class="avatar-crop-actions"><button class="secondary" data-avatar="rotate">向右旋转</button><button class="secondary" data-avatar="reselect">重新选择</button></div></div>', '<button class="secondary" data-avatar="cancel">取消</button><button class="primary" data-avatar="save">保存头像</button>');
      const canvas = $2("#avatar-canvas");
      let drag = null;
      canvas.onpointerdown = (e) => {
        canvas.setPointerCapture(e.pointerId);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: s.x, dy: s.y };
      };
      canvas.onpointermove = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const scale = 512 / canvas.getBoundingClientRect().width;
        s.x = drag.dx + (e.clientX - drag.x) * scale;
        s.y = drag.dy + (e.clientY - drag.y) * scale;
        draw();
      };
      canvas.onpointerup = canvas.onpointercancel = (e) => {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        drag = null;
      };
      $2("#avatar-zoom").oninput = (e) => {
        s.zoom = Number(e.target.value);
        draw();
      };
      draw();
    }
    async function save(reset = false, preset = false) {
      var _a, _b, _c, _d;
      const s = current;
      if (!s || s.busy) return;
      s.busy = true;
      document.querySelectorAll(".modal button,.modal input").forEach((e) => e.disabled = true);
      try {
        let result;
        if (preset) result = await api2(endpoint(s), { method: "PATCH", body: { avatar: s.selected } });
        else if (reset) result = await api2(endpoint(s), { method: "DELETE" });
        else {
          const canvas = $2("#avatar-canvas");
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
          if (current !== s || ((_a = S2.user) == null ? void 0 : _a.id) !== s.actor) return;
          if (!blob) throw Error("无法生成头像，请重新选择图片");
          const body = new FormData();
          body.append("file", blob, "avatar.jpg");
          result = await api2(endpoint(s), { method: "POST", body });
        }
        if (current !== s || ((_b = S2.user) == null ? void 0 : _b.id) !== s.actor) return;
        if (s.scope === "user") {
          const user = await api2("/api/me");
          if (current !== s || ((_c = S2.user) == null ? void 0 : _c.id) !== s.actor) return;
          S2.user = user;
        }
        await refresh2();
        if (current !== s || ((_d = S2.user) == null ? void 0 : _d.id) !== s.actor) return;
        s.info.avatar = result.avatar;
        toast2(reset ? "已恢复默认头像" : "头像已更新");
        finish(true);
      } catch (e) {
        if (current === s) {
          s.busy = false;
          document.querySelectorAll(".modal button,.modal input").forEach((e2) => e2.disabled = false);
          toast2(e.message);
        }
      }
    }
    function openUser() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
      const draft = { name: (_b = (_a = $2("#profile-name")) == null ? void 0 : _a.value) != null ? _b : S2.user.name, bio: (_d = (_c = $2("#profile-bio")) == null ? void 0 : _c.value) != null ? _d : S2.user.bio, phone: (_f = (_e = $2("#profile-phone")) == null ? void 0 : _e.value) != null ? _f : S2.user.phone, gender: (_h = (_g = $2("#profile-gender")) == null ? void 0 : _g.value) != null ? _h : S2.user.gender, jobTitle: (_j = (_i = $2("#profile-job")) == null ? void 0 : _i.value) != null ? _j : S2.user.jobTitle, avatar: ((_k = $2(".color-list .selected")) == null ? void 0 : _k.dataset.color) || S2.user.avatar };
      release();
      current = { scope: "user", actor: S2.user.id, target: S2.user.id, info: __spreadValues({}, S2.user), back: (changed2) => profile2(__spreadProps(__spreadValues({}, draft), { avatar: changed2 ? S2.user.avatar : draft.avatar })) };
      choose();
    }
    async function openGroup(id) {
      var _a, _b, _c;
      const actor = (_a = S2.user) == null ? void 0 : _a.id;
      try {
        const c = await api2("/api/conversations/" + id);
        if (((_b = S2.user) == null ? void 0 : _b.id) !== actor) return;
        if (!["owner", "admin"].includes((_c = c.group) == null ? void 0 : _c.role)) throw Error("只有群主和管理员可以修改群头像");
        release();
        current = { scope: "group", actor, target: id, info: { name: c.name, kind: "group", avatar: c.group.avatar }, back: () => groupDetail(id) };
        choose();
      } catch (e) {
        toast2(e.message);
      }
    }
    function changed(d) {
      if (!S2.user) return;
      if (d.userId === S2.user.id) Object.assign(S2.user, { name: d.name, avatar: d.avatar, bio: d.bio, phone: d.phone, gender: d.gender, jobTitle: d.jobTitle });
      for (const u of S2.friends) if (u.id === d.userId) Object.assign(u, { name: d.name, avatar: d.avatar, bio: d.bio, phone: d.phone, gender: d.gender, jobTitle: d.jobTitle });
      for (const m of S2.messages) if (m.sender === d.userId) m.avatar = d.avatar;
      document.querySelectorAll('.avatar[data-avatar-user="'.concat(d.userId, '"]')).forEach((node) => {
        const online = !!node.querySelector(".dot"), size = node.classList.contains("large") ? "large" : node.classList.contains("small") ? "small" : "";
        node.outerHTML = av2(__spreadProps(__spreadValues({}, d), { id: d.userId, online }), size, online);
      });
      updateRail2();
      renderMessages2(true);
      if (S2.tab === "profile") renderMain2();
    }
    document.addEventListener("error", (e) => {
      var _a;
      if ((_a = e.target.classList) == null ? void 0 : _a.contains("avatar-photo")) e.target.hidden = true;
    }, true);
    document.addEventListener("click", (e) => {
      if (current && e.target.closest('[data-action="close-modal"]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!current.busy) finish();
      }
    }, true);
    document.addEventListener("click", (e) => {
      var _a, _b;
      const option = e.target.closest("[data-cartoon]");
      if (option && (current == null ? void 0 : current.scope) === "user" && !current.busy) {
        current.selected = option.dataset.cartoon;
        document.querySelectorAll("#cartoon-options [data-cartoon]").forEach((n) => {
          n.classList.toggle("selected", n === option);
          n.setAttribute("aria-checked", String(n === option));
        });
        $2(".cartoon-preview .avatar").outerHTML = av2(__spreadProps(__spreadValues({}, current.info), { avatar: current.selected }), "large");
        $2("[data-avatar=save-cartoon]").disabled = false;
        return;
      }
      const b = e.target.closest("[data-avatar]");
      if (!b) return;
      const action2 = b.dataset.avatar;
      if (action2 === "user") {
        openUser();
        return;
      }
      if (action2 === "group") {
        openGroup(b.dataset.groupId);
        return;
      }
      const s = current;
      if (!s || s.busy) return;
      if (action2 === "cancel") finish();
      if (action2 === "shuffle") {
        s.choices = cartoonChoices(8, ((_a = s.choices) == null ? void 0 : _a.map((a) => a.id)) || []);
        s.all = false;
        chooseCartoon();
      }
      if (action2 === "recommended") {
        s.all = false;
        chooseCartoon();
      }
      if (action2 === "all-cartoons") {
        s.all = true;
        chooseCartoon();
      }
      if (action2 === "save-cartoon") save(false, true);
      if (action2 === "pick") (_b = $2("#avatar-file")) == null ? void 0 : _b.click();
      if (action2 === "reselect") choose();
      if (action2 === "rotate") {
        s.angle = (s.angle + 90) % 360;
        s.x = s.y = 0;
        s.zoom = 1;
        $2("#avatar-zoom").value = "1";
        draw();
      }
      if (action2 === "save") save();
      if (action2 === "reset") {
        modal2("恢复默认头像", "<p>确定移除当前照片，恢复默认头像？</p>", '<button class="secondary" data-avatar="cancel">取消</button><button class="primary" data-avatar="reset-confirm">确定</button>');
      }
      if (action2 === "reset-confirm") save(true);
    });
    new MutationObserver(() => {
      if (current && !$2("#avatar-editor") && !$2("#avatar-file") && !document.querySelector('[data-avatar="reset-confirm"]')) release();
    }).observe($2("#overlays"), { childList: true });
    return { changed, reset: release };
  }

  // internal/ui/src/local-store.js
  var database;
  function openLocalStore() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("welink-local", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["queue", "drafts", "cache"]) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          store.createIndex("scope", "scope");
        }
        db.createObjectStore("blobs");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error("请关闭其他 LinkMe 窗口后重试"));
    }).catch((error) => {
      database = null;
      throw error;
    });
    return database;
  }
  async function transaction(names, mode, work) {
    const db = await openLocalStore();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode), stores = {};
      for (const name of names) stores[name] = tx.objectStore(name);
      let result, error;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(error || tx.error || Error("本地保存失败"));
      tx.onerror = () => {
      };
      try {
        work(stores, (value) => {
          result = value;
        }, (reason) => {
          error = reason;
          tx.abort();
        });
      } catch (reason) {
        error = reason;
        tx.abort();
      }
    });
  }
  var scopedRows = (name, scope) => transaction([name], "readonly", (stores, done) => {
    const r = stores[name].index("scope").getAll(scope);
    r.onsuccess = () => done(r.result);
  });
  var localGet = (name, id) => transaction([name], "readonly", (stores, done) => {
    const r = stores[name].get(id);
    r.onsuccess = () => done(r.result);
  });
  var localPut = (name, value) => transaction([name], "readwrite", (stores) => stores[name].put(value));

  // internal/ui/src/outbox.js
  function createOutbox({ onSent = () => {
  }, sendLarge, S: S2, api: api2, toast: toast2, esc: esc2, av: av2, bytes: bytes2, randomID: randomID2, Mentions: Mentions2, renderMessages: renderMessages2, renderReply: renderReply2, queueRefresh: queueRefresh2, modal: modal2, closeModal: closeModal2 }) {
    const $2 = (selector) => document.querySelector(selector);
    let scope = "", generation = 0, rows = [], drafts = /* @__PURE__ */ new Map(), timer, working = false, controller, saveChain = Promise.resolve(), storageWarning = false;
    const scopeFor = () => {
      var _a;
      return JSON.stringify([new URL(S2.config.server).href.replace(/\/$/, ""), (S2.config.fingerprint || "").toLowerCase(), (_a = S2.user) == null ? void 0 : _a.id]);
    };
    const alive = (g, key) => g === generation && key === scope && S2.user && !S2.signingOut;
    const draftID = (cid) => JSON.stringify([scope, cid]);
    function storageError(error) {
      if (!storageWarning) {
        storageWarning = true;
        toast2("无法保存到本机：" + (error.name === "QuotaExceededError" ? "存储空间不足，请清理待发送文件" : error.message));
      }
    }
    async function refreshRows(g = generation, key = scope) {
      if (!key) return;
      const result = await scopedRows("queue", key);
      if (alive(g, key)) {
        const next = result.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
        if (JSON.stringify(rows) !== JSON.stringify(next)) {
          rows = next;
          renderMessages2(true);
          updatePanel();
        }
      }
    }
    function stop() {
      generation++;
      scope = "";
      clearTimeout(timer);
      controller == null ? void 0 : controller.abort();
      controller = null;
      rows = [];
      drafts.clear();
      working = false;
    }
    async function start() {
      stop();
      const g = generation, key = scope = scopeFor();
      try {
        await openLocalStore();
        const saved = await scopedRows("drafts", key);
        if (!alive(g, key)) return;
        for (const d of saved) {
          drafts.set(d.cid, d);
          S2.drafts[d.cid] = d.text;
          Mentions2.restore(d.cid, d.text, d.mentions);
        }
        await refreshRows(g, key);
        storageWarning = false;
        kick();
      } catch (error) {
        storageError(error);
      }
    }
    function saveDraft() {
      var _a;
      if (!scope || !S2.active || S2.signingOut) return Promise.resolve();
      const cid = S2.active, el = $2("#composer");
      if (!el) return Promise.resolve();
      const d = { id: draftID(cid), scope, cid, text: el.value, mentions: Mentions2.payload().map((m) => __spreadValues({}, m)), replyId: ((_a = S2.reply) == null ? void 0 : _a.id) || "", updated: Date.now(), revision: randomID2() };
      drafts.set(cid, d);
      const task = saveChain.then(() => localPut("drafts", d));
      saveChain = task.catch(storageError);
      return task;
    }
    async function restoreReply(cid) {
      const d = drafts.get(cid), g = generation, key = scope;
      if (!(d == null ? void 0 : d.replyId)) return;
      try {
        let m = S2.messages.find((m2) => m2.id === d.replyId);
        if (!m) {
          const messages = await api2("/api/conversations/" + cid + "/messages?around=" + encodeURIComponent(d.replyId));
          m = messages.find((m2) => m2.id === d.replyId);
        }
        if (!alive(g, key) || S2.active !== cid || drafts.get(cid) !== d) return;
        if (m && !m.recalled) {
          S2.reply = m;
          renderReply2();
        } else {
          d.replyId = "";
          S2.reply = null;
          renderReply2();
          await localPut("drafts", d);
          toast2("草稿引用的消息已撤回或不可访问");
        }
      } catch (error) {
        if (!alive(g, key) || S2.active !== cid || drafts.get(cid) !== d) return;
        if (error.status === 400 || error.status === 403 || error.status === 404) {
          d.replyId = "";
          S2.reply = null;
          renderReply2();
          await localPut("drafts", d);
        } else toast2("引用暂未恢复，请联网后重试");
      }
    }
    async function enqueue(cid, body, file, metadata2 = {}, clearDraft = false) {
      var _a, _b, _c, _d;
      if (!scope || !S2.user || S2.signingOut) throw Error("请先登录再发送");
      if (file && ((_a = S2.policy) == null ? void 0 : _a.chatMaxAttachmentBytes) > 0 && file.size > S2.policy.chatMaxAttachmentBytes) throw Error("文件超过服务器配置的大小限制");
      if ((file == null ? void 0 : file.size) > ((_b = S2.policy.chatPersistAttachmentBytes) != null ? _b : 50 * 1024 * 1024)) return sendLarge(cid, body, file, metadata2);
      const g = generation, key = scope, id = randomID2(), draftRevision = (_c = drafts.get(cid)) == null ? void 0 : _c.revision, record = { id, scope: key, cid, body: __spreadProps(__spreadValues({}, body), { clientId: id }), created: Date.now(), state: "waiting", attempts: 0, next: 0, file: file ? { name: file.name, type: file.type, size: file.size } : null, metadata: metadata2 };
      await saveChain;
      if (!alive(g, key)) throw Error("登录账号已变化，请重新选择内容");
      try {
        await transaction(["queue", "blobs", "drafts"], "readwrite", (stores, done, abort) => {
          const request2 = stores.queue.index("scope").getAll(key);
          request2.onsuccess = () => {
            var _a2;
            if (request2.result.length >= (S2.policy.chatOfflineQueueMessages || 100) || request2.result.reduce((n, r) => {
              var _a3;
              return n + (((_a3 = r.file) == null ? void 0 : _a3.size) || 0);
            }, 0) + ((file == null ? void 0 : file.size) || 0) > ((_a2 = S2.policy.chatOfflineQueueBytes) != null ? _a2 : 250 * 1024 * 1024)) {
              abort(Error("本机待发送队列已满，请先处理已有消息"));
              return;
            }
            stores.queue.add(record);
            if (file) stores.blobs.put(file, id);
            if (clearDraft) {
              const draft = stores.drafts.get(JSON.stringify([key, cid]));
              draft.onsuccess = () => {
                var _a3;
                if (((_a3 = draft.result) == null ? void 0 : _a3.revision) === draftRevision) stores.drafts.delete(JSON.stringify([key, cid]));
              };
            }
          };
        });
      } catch (error) {
        if (file && alive(g, key)) return sendLarge(cid, body, file, metadata2);
        throw error;
      }
      if (!alive(g, key)) return;
      storageWarning = false;
      if (clearDraft && ((_d = drafts.get(cid)) == null ? void 0 : _d.revision) === draftRevision) {
        drafts.delete(cid);
        S2.drafts[cid] = "";
        Mentions2.clear(cid);
      }
      await refreshRows(g, key).catch(storageError);
      kick();
    }
    async function update(id, changes) {
      await transaction(["queue"], "readwrite", (stores) => {
        const r = stores.queue.get(id);
        r.onsuccess = () => {
          if (r.result) stores.queue.put(__spreadValues(__spreadValues({}, r.result), changes));
        };
      });
    }
    async function remove(id) {
      await transaction(["queue", "blobs"], "readwrite", (stores) => {
        stores.queue.delete(id);
        stores.blobs.delete(id);
      });
    }
    async function ack(message) {
      var _a;
      if (!scope || message.sender !== ((_a = S2.user) == null ? void 0 : _a.id) || !message.clientId) return;
      const g = generation, key = scope;
      const row = await localGet("queue", message.clientId);
      if ((row == null ? void 0 : row.scope) !== key || row.cid !== message.conversationId) return;
      await remove(row.id);
      if (alive(g, key)) Promise.resolve(onSent(message)).catch(() => {
      });
      await refreshRows(g, key);
    }
    function kick() {
      clearTimeout(timer);
      if (scope && !working) timer = setTimeout(() => work().catch(storageError), 100);
    }
    async function request(path, options, g, key) {
      if (!alive(g, key)) throw Error("账号已切换");
      const native = typeof AbortController === "function" ? new AbortController() : null;
      let rejectAbort;
      const cancelled = new Promise((resolve, reject) => {
        rejectAbort = reject;
      }), pending = { abort() {
        native == null ? void 0 : native.abort();
        rejectAbort(Object.assign(Error("请求已中断"), { name: "AbortError" }));
      } };
      controller = pending;
      const timeout = setTimeout(() => pending.abort(), 65e3);
      try {
        return await Promise.race([api2(path, __spreadValues(__spreadValues({}, options), native ? { signal: native.signal } : {})), cancelled]);
      } finally {
        clearTimeout(timeout);
        if (controller === pending) controller = null;
      }
    }
    async function work() {
      if (working || !scope || !S2.user || S2.signingOut) return;
      working = true;
      const g = generation, key = scope;
      try {
        const pending = (await scopedRows("queue", key)).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
        if (!alive(g, key)) return;
        const seen = /* @__PURE__ */ new Set(), candidate = pending.find((r) => {
          if (seen.has(r.cid)) return false;
          seen.add(r.cid);
          return r.state !== "failed" && r.next <= Date.now();
        });
        if (!candidate) return;
        const row = candidate;
        await update(row.id, { state: "sending", attempts: row.attempts + 1 });
        await refreshRows(g, key);
        try {
          if (row.attempts) {
            const receipt = await request("/api/outbox/" + row.id, {}, g, key);
            if (receipt.delivered) {
              if (receipt.conversationId !== row.cid) throw Object.assign(Error("消息标识与会话不一致"), { status: 409 });
              await remove(row.id);
              if (alive(g, key)) {
                if (S2.active === row.cid && !S2.historyMode) {
                  const messages = await request("/api/conversations/" + row.cid + "/messages", {}, g, key);
                  if (alive(g, key) && S2.active === row.cid && !S2.historyMode) S2.messages = messages;
                }
                queueRefresh2(true);
              }
              return;
            }
          }
          let body = __spreadValues({}, row.body);
          if (row.file && !row.attachment) {
            const file = await localGet("blobs", row.id);
            if (!file) throw Object.assign(Error("本机附件已丢失，请重新选择文件"), { status: 400 });
            const form = new FormData();
            form.append("conversationId", row.cid);
            form.append("clientId", row.id);
            form.append("file", file, row.file.name);
            if (body.kind === "voice" || body.kind === "video") form.append("mediaKind", body.kind);
            for (const [k, v] of Object.entries(row.metadata)) form.append(k, String(v));
            row.attachment = await request("/api/files", { method: "POST", body: form }, g, key);
            if (!alive(g, key)) return;
            await update(row.id, { attachment: row.attachment });
          }
          if (row.attachment) {
            body.attachmentId = row.attachment.id;
            if (body.kind === "auto") body.kind = /^image\/(png|jpeg|gif|webp)$/.test(row.attachment.mime) ? "image" : "file";
          }
          if (!await localGet("queue", row.id)) return;
          const message = await request("/api/conversations/" + row.cid + "/messages", { method: "POST", body }, g, key);
          if (!alive(g, key)) return;
          await remove(row.id);
          Promise.resolve(onSent(message)).catch(() => {
          });
          if (S2.active === row.cid && !S2.historyMode && !S2.messages.some((m) => m.id === message.id)) {
            S2.messages.push(message);
            S2.messages.sort((a, b) => a.seq - b.seq);
          }
          queueRefresh2(true);
        } catch (error) {
          if (!alive(g, key)) return;
          const permanent = error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
          await update(row.id, { state: permanent ? "failed" : "waiting", error: permanent ? error.message : "网络异常，等待重试", next: Date.now() + (error.status === 429 ? 6e4 : Math.min(3e4, 2e3 * 2 ** Math.min(row.attempts, 4))) });
        }
      } finally {
        if (alive(g, key)) {
          working = false;
          await refreshRows(g, key);
          timer = setTimeout(() => work().catch(storageError), 1e3);
        }
      }
    }
    const status = (row) => row.state === "sending" ? "正在发送…" : row.state === "failed" ? row.error : row.error || "已保存，等待发送";
    function item(row, panel = false) {
      var _a;
      const content = row.file ? "<b>".concat(esc2(row.body.kind === "voice" ? "语音" : row.file.name), "</b><small>").concat(bytes2(row.file.size), "</small>") : esc2(row.body.text);
      return '<article class="'.concat(panel ? "outbox-row" : "message mine pending-message", '" data-outbox="').concat(row.id, '">').concat(panel ? "" : av2(S2.user), '<div class="message-body">').concat(panel ? "<b>" + esc2(((_a = S2.conversations.find((c) => c.id === row.cid)) == null ? void 0 : _a.name) || "原会话已不可访问") + "</b>" : "", '<div class="bubble">').concat(content, '</div><div class="outbox-status ').concat(row.state === "failed" ? "failed" : "", '" role="status">').concat(esc2(status(row)), '</div><div class="outbox-actions">').concat(row.state !== "sending" ? '<button data-outbox-retry="' + row.id + '">重试</button>' : "", '<button data-outbox-remove="').concat(row.id, '">移除待发送</button></div></div></article>');
    }
    function html(cid) {
      return S2.historyMode ? "" : rows.filter((r) => r.cid === cid && !S2.messages.some((m) => {
        var _a;
        return m.clientId === r.id && m.sender === ((_a = S2.user) == null ? void 0 : _a.id);
      })).map((r) => item(r)).join("");
    }
    function updatePanel() {
      const panel = $2("#outbox-list");
      if (panel) panel.innerHTML = rows.map((r) => item(r, true)).join("") || '<p class="empty-list">没有待发送消息</p>';
    }
    function show() {
      modal2("待发送消息", '<p class="hint">保存在此设备，登录同一服务器和账号后继续发送。每个会话依次发送；失败消息需重试或移除。</p><div id="outbox-list"></div>', "", true);
      updatePanel();
    }
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-outbox-open],[data-outbox-retry],[data-outbox-remove]");
      if (!button || !scope) return;
      const g = generation, key = scope;
      try {
        if (button.hasAttribute("data-outbox-open")) {
          show();
          return;
        }
        const id = button.dataset.outboxRetry || button.dataset.outboxRemove, row = rows.find((r) => r.id === id);
        if (!row) return;
        if (button.dataset.outboxRetry) {
          await update(id, { state: "waiting", next: 0, error: "" });
          await refreshRows(g, key);
          kick();
          return;
        }
        modal2("移除待发送消息", '<p class="hint">只移除此设备的待发送副本。如果服务器已经收到，这条消息仍会保留在聊天记录中，可在聊天里撤回。</p>', '<button class="secondary" data-action="close-modal">保留</button><button class="primary" id="outbox-confirm-remove">移除</button>');
        $2("#outbox-confirm-remove").onclick = async () => {
          if (!alive(g, key)) return;
          await remove(id);
          closeModal2();
          await refreshRows(g, key);
          kick();
        };
      } catch (error) {
        toast2(error.message);
      }
    });
    window.addEventListener("online", kick);
    return { start, stop, kick, ack, html, saveDraft, restoreReply, enqueue, replyPlaceholder: (cid) => {
      var _a;
      return ((_a = drafts.get(cid)) == null ? void 0 : _a.replyId) ? { id: drafts.get(cid).replyId, name: "原消息", text: "正在恢复引用…", kind: "text" } : null;
    }, scope: () => scope, settingsRow: () => '<div class="prefs-row"><span>本机待发送消息</span><button class="secondary" data-outbox-open>管理</button></div>' };
  }

  // internal/ui/src/received-cache.js
  var metadata = /* @__PURE__ */ new Set(["/api/me", "/api/config", "/api/public-config", "/api/conversations", "/api/friends", "/api/requests", "/api/group-requests", "/api/contact-groups"]);
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var clone = (value) => JSON.parse(JSON.stringify(value));
  var classify = (path) => {
    const url = new URL(path, location.origin), match = url.pathname.match(/^\/api\/conversations\/([a-f0-9]{32})(\/messages)?$/);
    return metadata.has(url.pathname) ? { name: url.pathname, url } : match ? { name: match[2] ? "messages:" + match[1] : url.pathname, cid: match[1], messages: !!match[2], url } : null;
  };
  var temporary = (error) => !error.status && error.name !== "AbortError" || [408, 502, 503, 504].includes(error.status);
  function createReceivedCache({ S: S2, toast: toast2, modal: modal2, closeModal: closeModal2, esc: esc2, bytes: bytes2, connectionState: connectionState2, onReconciled }) {
    let current = null;
    const identity = () => JSON.stringify([new URL(S2.config.server).href.replace(/\/$/, ""), (S2.config.fingerprint || "").toLowerCase(), S2.token]);
    const alive = (ctx) => current === ctx && !ctx.dead && ctx.token === S2.token && !S2.signingOut && ctx.identity === identity();
    const limits = (ctx) => {
      var _a, _b, _c, _d, _e;
      const p = ((_a = ctx.records.get("/api/config")) == null ? void 0 : _a.data) || S2.policy || {};
      return { messages: (_b = p.receivedCacheMessages) != null ? _b : 5e3, bytes: (_c = p.receivedCacheBytes) != null ? _c : 20 * 1024 * 1024, days: (_d = p.receivedCacheDays) != null ? _d : 30, conversations: (_e = p.receivedCacheConversations) != null ? _e : 100 };
    };
    function warning(ctx) {
      if (!ctx.warned && alive(ctx)) {
        ctx.warned = true;
        toast2("本机聊天缓存暂时不可用，联网聊天不受影响");
      }
    }
    async function context() {
      if (!/^[a-f0-9]{64}$/.test(S2.token) || !S2.config.server || !crypto.subtle) return null;
      const key = identity();
      if ((current == null ? void 0 : current.identity) === key) return current.ready;
      const ctx = current = { identity: key, token: S2.token, records: /* @__PURE__ */ new Map(), revision: 0, chain: Promise.resolve(), dead: false };
      ctx.ready = (async () => {
        const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
        ctx.scope = "received:" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
        ctx.key = await crypto.subtle.importKey("raw", Uint8Array.from(ctx.token.match(/../g), (b) => parseInt(b, 16)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
        await transaction(["cache"], "readwrite", (stores) => {
          const r = stores.cache.openCursor();
          r.onsuccess = () => {
            var _a;
            const cursor = r.result;
            if (cursor) {
              if (((_a = cursor.value.scope) == null ? void 0 : _a.startsWith("received:")) && cursor.value.expires < Date.now()) cursor.delete();
              cursor.continue();
            }
          };
        });
        for (const row of await scopedRows("cache", ctx.scope)) {
          try {
            const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData: encoder.encode(ctx.scope + "\n" + row.name) }, ctx.key, row.cipher), value = JSON.parse(decoder.decode(plain));
            ctx.records.set(row.name, __spreadProps(__spreadValues({}, value), { versions: /* @__PURE__ */ new Map(), revision: 0, size: plain.byteLength }));
          } catch (e) {
            ctx.records.set(row.name, { invalid: true, updated: 0, size: 0 });
          }
        }
        if (alive(ctx)) await flush(ctx, /* @__PURE__ */ new Set());
        return ctx;
      })().catch(() => {
        warning(ctx);
        return null;
      });
      return ctx.ready;
    }
    function serial(ctx, work) {
      const next = ctx.chain.then(() => alive(ctx) ? work() : void 0);
      ctx.chain = next.catch(() => warning(ctx));
      return next;
    }
    function record(ctx, name, data) {
      let row = ctx.records.get(name);
      if (!row || row.invalid) {
        row = { data, versions: /* @__PURE__ */ new Map(), revision: 0, updated: Date.now(), size: 0 };
        ctx.records.set(name, row);
      }
      return row;
    }
    function prune(ctx, changed) {
      const policy = limits(ctx), now = Date.now(), allowed = policy.messages > 0 && policy.bytes > 0;
      for (const [name, row] of ctx.records) if (!allowed || row.invalid || now - row.updated > policy.days * 864e5) {
        ctx.records.delete(name);
        changed.add(name);
      }
      let chats = [...ctx.records].filter(([name]) => name.startsWith("messages:")).sort((a, b) => b[1].updated - a[1].updated);
      for (const [name] of chats.slice(policy.conversations)) {
        ctx.records.delete(name);
        changed.add(name);
      }
      chats = chats.slice(0, policy.conversations);
      let count = chats.reduce((n, [, r]) => n + r.data.items.length, 0);
      for (const [name, row] of [...chats].reverse()) if (count > policy.messages) {
        const remove = Math.min(row.data.items.length, count - policy.messages);
        row.data.items.splice(0, remove);
        count -= remove;
        changed.add(name);
      }
      for (const [, row] of chats) {
        const retained = /* @__PURE__ */ new Set([...row.data.items.map((m) => m.id), ...row.data.deleted]);
        for (const id of row.versions.keys()) if (!retained.has(id)) row.versions.delete(id);
      }
      for (const name of changed) {
        const row = ctx.records.get(name);
        if (row) row.size = encoder.encode(JSON.stringify({ data: row.data, updated: row.updated })).byteLength;
      }
      let total = [...ctx.records.values()].reduce((n, r) => n + r.size, 0);
      const ordered = [...ctx.records].sort((a, b) => Number(!a[0].startsWith("messages:")) - Number(!b[0].startsWith("messages:")) || a[1].updated - b[1].updated);
      for (const [name, row] of ordered) if (total > policy.bytes) {
        ctx.records.delete(name);
        changed.add(name);
        total -= row.size;
      }
    }
    async function flush(ctx, changed) {
      prune(ctx, changed);
      const writes = [];
      for (const name of changed) {
        const row = ctx.records.get(name), id = JSON.stringify([ctx.scope, name]);
        if (!row) {
          writes.push({ id });
          continue;
        }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(ctx.scope + "\n" + name) }, ctx.key, encoder.encode(JSON.stringify({ data: row.data, updated: row.updated })));
        writes.push({ id, scope: ctx.scope, name, iv, cipher, expires: row.updated + limits(ctx).days * 864e5 });
      }
      if (!writes.length || !alive(ctx)) return;
      await transaction(["cache"], "readwrite", (stores) => {
        if (!alive(ctx)) return;
        for (const row of writes) if (row.cipher) stores.cache.put(row);
        else stores.cache.delete(row.id);
      });
    }
    function merge(ctx, cid, items, ticket, changed, checked) {
      var _a;
      const name = "messages:" + cid, row = record(ctx, name, { items: [], deleted: [] }), map = new Map(row.data.items.map((m) => [m.id, m])), deleted = new Set(row.data.deleted);
      const returned = new Set(items.map((m) => m.id));
      if (checked) {
        for (const id of checked) if (!returned.has(id) && (row.versions.get(id) || 0) <= ticket) {
          map.delete(id);
          deleted.add(id);
          row.versions.set(id, ticket);
        }
      }
      for (const message of items) {
        if (message.conversationId !== cid || deleted.has(message.id) || (row.versions.get(message.id) || 0) > ticket) continue;
        if (((_a = map.get(message.id)) == null ? void 0 : _a.recalled) && !message.recalled) continue;
        map.set(message.id, clone(message));
        row.versions.set(message.id, ticket);
      }
      row.data = { items: [...map.values()].sort((a, b) => a.seq - b.seq), deleted: [...deleted].slice(-limits(ctx).messages) };
      row.updated = Date.now();
      changed.add(name);
      const conversations = ctx.records.get("/api/conversations");
      for (const conversation of (conversations == null ? void 0 : conversations.data) || []) {
        if (conversation.id !== cid || !conversation.last) continue;
        if (deleted.has(conversation.last.id)) conversation.last = row.data.items[row.data.items.length - 1] || null;
        else if (map.has(conversation.last.id)) conversation.last = clone(map.get(conversation.last.id));
        conversations.revision = Math.max(conversations.revision, ticket);
        changed.add("/api/conversations");
      }
    }
    async function remember(ctx, info, value, ticket) {
      return serial(ctx, async () => {
        const changed = /* @__PURE__ */ new Set();
        let result = value;
        if (info.messages) {
          merge(ctx, info.cid, value, ticket, changed);
          const row = ctx.records.get(info.name), returned = new Set(value.map((m) => m.id));
          const candidates = row.data.items.filter((m) => returned.has(m.id) || (row.versions.get(m.id) || 0) > ticket), around = info.url.searchParams.get("around");
          result = around && !candidates.some((m) => m.id === around) ? [] : selectMessages(ctx, info, candidates);
        } else {
          const row = record(ctx, info.name, value);
          if (row.revision > ticket) return clone(row.data);
          row.data = clone(value);
          row.revision = ticket;
          row.updated = Date.now();
          changed.add(info.name);
          if (info.name === "/api/conversations") {
            const ids = new Set(value.map((c) => c.id));
            for (const name of ctx.records.keys()) if (name.startsWith("messages:") && !ids.has(name.slice(9)) || /^\/api\/conversations\/[a-f0-9]{32}$/.test(name) && !ids.has(name.slice(19))) {
              ctx.records.delete(name);
              changed.add(name);
            }
          }
        }
        await flush(ctx, changed);
        return result;
      });
    }
    function selectMessages(ctx, info, source) {
      var _a, _b;
      const row = ctx.records.get(info.name);
      if (!row) return void 0;
      const q = info.url.searchParams;
      let items = (source || row.data.items).slice();
      const around = q.get("around");
      if (around) {
        const at = items.findIndex((m) => m.id === around);
        if (at < 0) throw Error("本机尚未缓存这条消息，请联网后查看");
        items = items.slice(Math.max(0, at - 30), at + 31);
      }
      const text = (q.get("q") || "").trim().toLowerCase(), kind = q.get("kind"), sender = q.get("sender"), before = Number(q.get("before") || Infinity), after = Number(q.get("after") || 0), from = Number(q.get("from") || 0), to = Number(q.get("to") || Infinity), user = (_b = (_a = ctx.records.get("/api/me")) == null ? void 0 : _a.data) == null ? void 0 : _b.id;
      items = items.filter((m) => m.seq < before && m.seq > after && m.created >= from && m.created < to && (!text || !m.recalled && (m.text + " " + (m.fileName || "")).toLowerCase().includes(text)) && (!kind || !m.recalled && m.kind === kind) && (!sender || m.sender === sender) && (!q.get("mentions") || !m.recalled && (m.mentionRecipients || []).includes(user)));
      return clone(around ? items : after ? items.slice(0, 60) : items.slice(-60));
    }
    async function cached(ctx, info) {
      return serial(ctx, async () => {
        var _a;
        await flush(ctx, /* @__PURE__ */ new Set());
        const data = info.messages ? selectMessages(ctx, info) : (_a = ctx.records.get(info.name)) == null ? void 0 : _a.data;
        return data === void 0 ? void 0 : clone(data);
      });
    }
    async function dropConversation(ctx, cid) {
      return serial(ctx, async () => {
        const changed = /* @__PURE__ */ new Set(["messages:" + cid, "/api/conversations/" + cid]);
        for (const name of changed) ctx.records.delete(name);
        const row = ctx.records.get("/api/conversations");
        if (row) {
          row.data = row.data.filter((c) => c.id !== cid);
          changed.add("/api/conversations");
        }
        await flush(ctx, changed);
      });
    }
    async function run(path, options, network) {
      const method = options.method || "GET", info = method === "GET" ? classify(path) : null, sent = method === "POST" && /^\/api\/conversations\/[a-f0-9]{32}\/messages$/.test(path) ? classify(path) : null, ctx = info || sent ? await context() : null, ticket = ctx ? ++ctx.revision : 0;
      let timer;
      try {
        const request = network().then(async (value) => {
          if (ctx && alive(ctx)) try {
            if (sent) {
              await serial(ctx, async () => {
                const changed = /* @__PURE__ */ new Set();
                merge(ctx, sent.cid, [value], ticket, changed);
                await flush(ctx, changed);
              });
            } else {
              const canonical = await remember(ctx, info, value, ticket);
              if (canonical !== void 0) return canonical;
            }
          } catch (e) {
            warning(ctx);
          }
          return value;
        });
        if (!ctx || !info || !ctx.records.has(info.name) || options.signal) return await request;
        return await Promise.race([request, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(Error("连接暂时不可用"), { status: 504 })), S2.cacheView ? 0 : 6e3);
        })]);
      } catch (error) {
        if (error.status === 401 && current === ctx) await forget();
        if (ctx && info && alive(ctx)) {
          if (error.status === 404 && info.messages && info.url.searchParams.get("around")) await event("message-deleted", { id: info.url.searchParams.get("around"), conversationId: info.cid }).catch(() => {
          });
          else if ((error.status === 403 || error.status === 404) && info.cid) await dropConversation(ctx, info.cid).catch(() => {
          });
          if (temporary(error)) {
            const value = await cached(ctx, info).catch(() => void 0);
            if (value !== void 0 && alive(ctx)) {
              S2.offline = true;
              S2.cacheView = true;
              connectionState2();
              if (info.name === "/api/friends") return value.map((u) => __spreadProps(__spreadValues({}, u), { online: false }));
              if (info.name === "/api/conversations") return value.map((c) => __spreadValues(__spreadValues({}, c), c.peer ? { peer: __spreadProps(__spreadValues({}, c.peer), { online: false }) } : {}));
              return value;
            }
          }
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    async function identified(user) {
      const ctx = await context();
      if (ctx) {
        await remember(ctx, { name: "/api/me" }, user, ++ctx.revision).catch(() => warning(ctx));
        await remember(ctx, { name: "/api/public-config" }, { registrationEnabled: S2.registrationEnabled }, ++ctx.revision).catch(() => warning(ctx));
      }
    }
    async function event(type, message) {
      const ctx = await context();
      if (!ctx || !alive(ctx) || !(message == null ? void 0 : message.conversationId)) return;
      const ticket = ++ctx.revision;
      await serial(ctx, async () => {
        var _a, _b, _c;
        const changed = /* @__PURE__ */ new Set();
        merge(ctx, message.conversationId, type === "message-deleted" ? [] : [message], ticket, changed, type === "message-deleted" ? [message.id] : null);
        if (type === "recall") {
          for (const [name, row] of ctx.records) if (name.startsWith("messages:")) {
            for (const item of row.data.items) if (((_a = item.reply) == null ? void 0 : _a.id) === message.id) {
              item.reply = __spreadProps(__spreadValues({}, item.reply), { text: "", fileName: "", recalled: true });
              row.versions.set(item.id, ticket);
              changed.add(name);
            }
          }
        }
        if (type === "recall") {
          const row = ctx.records.get("/api/conversations");
          for (const c of (row == null ? void 0 : row.data) || []) if (((_c = (_b = c.last) == null ? void 0 : _b.reply) == null ? void 0 : _c.id) === message.id) {
            c.last.reply = __spreadProps(__spreadValues({}, c.last.reply), { text: "", fileName: "", recalled: true });
            row.revision = Math.max(row.revision, ticket);
            changed.add("/api/conversations");
          }
        }
        await flush(ctx, changed);
      });
    }
    async function reconcile(network) {
      var _a;
      const ctx = await context();
      if (!ctx || !alive(ctx)) return;
      await ctx.chain;
      const batches = [...ctx.records].filter(([name]) => name.startsWith("messages:")).map(([name, row]) => ({ cid: name.slice(9), ids: row.data.items.map((m) => m.id) }));
      for (const { cid, ids } of batches) {
        let denied = false;
        for (let at = 0; at < ids.length; at += 200) {
          if (!alive(ctx)) return;
          const checked = ids.slice(at, at + 200), ticket = ++ctx.revision;
          try {
            const items = await network("/api/conversations/" + cid + "/messages/sync", { method: "POST", body: { ids: checked } });
            await serial(ctx, async () => {
              const changed = /* @__PURE__ */ new Set();
              merge(ctx, cid, items, ticket, changed, checked);
              await flush(ctx, changed);
            });
          } catch (error) {
            if ([403, 404, 405].includes(error.status)) {
              denied = true;
              await dropConversation(ctx, cid);
              break;
            }
            throw error;
          }
        }
        if (alive(ctx)) onReconciled(cid, clone(((_a = ctx.records.get("messages:" + cid)) == null ? void 0 : _a.data.items) || []), ids, denied);
      }
    }
    async function forget() {
      const ctx = current;
      current = null;
      if (!ctx) return;
      ctx.dead = true;
      await ctx.ready;
      await ctx.chain.catch(() => {
      });
      if (ctx.scope) await transaction(["cache"], "readwrite", (stores) => {
        const request = stores.cache.index("scope").openCursor(ctx.scope);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }).catch(() => {
      });
      ctx.records.clear();
    }
    async function show() {
      const ctx = await context();
      if (!ctx) {
        toast2("此设备暂不支持加密聊天缓存");
        return;
      }
      await ctx.chain;
      const count = [...ctx.records].filter(([name]) => name.startsWith("messages:")).reduce((n, [, r]) => n + r.data.items.length, 0), size = [...ctx.records.values()].reduce((n, r) => n + r.size, 0), policy = limits(ctx);
      modal2("本机聊天缓存", "<p>已缓存 <b>".concat(count, "</b> 条消息 · ").concat(esc2(bytes2(size)), '</p><p class="hint">断网时可查看本机已加载的聊天记录。图片、语音、视频和文件内容仍需联网打开。</p><p class="hint">当前上限 ').concat(policy.messages, " 条消息、").concat(esc2(bytes2(policy.bytes)), "，保留 ").concat(policy.days, " 天。缓存与此服务器和登录会话绑定，退出登录会清除；不会删除服务器记录、草稿或待发送消息。</p>"), '<button class="secondary" data-action="close-modal">关闭</button><button class="primary" id="clear-received-cache">清理本机缓存</button>');
      document.querySelector("#clear-received-cache").onclick = async () => {
        await forget();
        closeModal2();
        toast2("本机聊天缓存已清理，服务器记录仍保留");
      };
    }
    document.addEventListener("click", (event2) => {
      if (event2.target.closest("[data-received-cache]")) show().catch(() => toast2("无法读取本机聊天缓存"));
    });
    return { run, identified, event, reconcile, forget, settingsRow: () => '<div class="prefs-row"><span>本机聊天缓存</span><button class="secondary" data-received-cache>管理</button></div>' };
  }

  // internal/ui/src/mentions.js
  function createMentions({ S: S2, api: api2, esc: esc2, av: av2, toast: toast2, jump }) {
    const $2 = (s) => document.querySelector(s), drafts = /* @__PURE__ */ new Map();
    let popup = null, revision = 0, pending = null, cache = null;
    const group = () => {
      var _a;
      return ((_a = S2.conversations.find((c) => c.id === S2.active)) == null ? void 0 : _a.kind) === "group";
    };
    const input = () => $2("#composer");
    function state() {
      var _a;
      const cid = S2.active, text2 = ((_a = input()) == null ? void 0 : _a.value) || "";
      if (!drafts.has(cid)) drafts.set(cid, { text: text2, spans: [] });
      return drafts.get(cid);
    }
    function reconcile() {
      var _a;
      const d = state(), text2 = ((_a = input()) == null ? void 0 : _a.value) || "";
      if (text2 === d.text) return d;
      let left = 0;
      while (left < text2.length && left < d.text.length && text2[left] === d.text[left]) left++;
      let oldEnd = d.text.length, newEnd = text2.length;
      while (oldEnd > left && newEnd > left && d.text[oldEnd - 1] === text2[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      const delta = newEnd - oldEnd;
      d.spans = d.spans.reduce((kept, m) => {
        if (m.end <= left) kept.push(m);
        else if (m.start >= oldEnd) kept.push(__spreadProps(__spreadValues({}, m), { start: m.start + delta, end: m.end + delta }));
        return kept;
      }, []);
      d.text = text2;
      return d;
    }
    function hide() {
      var _a, _b, _c;
      revision++;
      popup = null;
      (_a = $2("#mention-picker")) == null ? void 0 : _a.remove();
      (_b = input()) == null ? void 0 : _b.setAttribute("aria-expanded", "false");
      (_c = input()) == null ? void 0 : _c.removeAttribute("aria-activedescendant");
    }
    async function members() {
      if ((cache == null ? void 0 : cache.cid) === S2.active && Date.now() - cache.at < 1e4) return cache.value;
      const cid = S2.active, value = await api2("/api/conversations/" + cid);
      if (cid === S2.active) cache = { cid, at: Date.now(), value };
      return value;
    }
    function render() {
      var _a, _b, _c, _d, _e;
      const p = popup;
      if (!p) return;
      (_a = $2("#mention-picker")) == null ? void 0 : _a.remove();
      const node = document.createElement("div");
      node.id = "mention-picker";
      node.className = "mention-picker";
      node.setAttribute("role", "listbox");
      node.setAttribute("aria-label", "选择要提醒的成员");
      node.innerHTML = '<div class="mention-picker-title">选择要提醒的成员</div>' + p.items.map((u, i) => '<button type="button" id="mention-option-'.concat(i, '" role="option" aria-selected="').concat(i === p.index, '" data-mention-index="').concat(i, '" class="').concat(i === p.index ? "selected" : "", '">').concat(u.id === "all" ? '<span class="mention-all-avatar">@</span>' : av2(u), "<span><b>").concat(esc2(u.nickname || u.name), "</b><small>").concat(u.id === "all" ? "提醒群内所有成员" : esc2(u.number), "</small></span></button>")).join("") + (p.items.length ? "" : '<p class="hint">没有找到成员</p>');
      node.onpointerdown = (e) => e.preventDefault();
      node.onclick = (e) => {
        const b = e.target.closest("[data-mention-index]");
        if (b) choose(p.items[Number(b.dataset.mentionIndex)]);
      };
      (_b = $2(".composer")) == null ? void 0 : _b.append(node);
      (_c = input()) == null ? void 0 : _c.setAttribute("aria-expanded", "true");
      if (p.items.length) {
        (_d = input()) == null ? void 0 : _d.setAttribute("aria-activedescendant", "mention-option-" + p.index);
        (_e = node.querySelector(".selected")) == null ? void 0 : _e.scrollIntoView({ block: "nearest" });
      }
    }
    async function show(start, end, query = "") {
      var _a, _b, _c;
      if (!group() || ((_a = input()) == null ? void 0 : _a.disabled)) return;
      const request = ++revision, cid = S2.active;
      try {
        const c = await members();
        if (request !== revision || cid !== S2.active || !input()) return;
        const q = query.toLocaleLowerCase();
        const all = ((_b = c.group) == null ? void 0 : _b.role) === "owner" || ((_c = c.group) == null ? void 0 : _c.role) === "admin";
        let users = c.members.filter((u) => u.id !== S2.user.id);
        if (all) users.unshift({ id: "all", name: "全体成员" });
        users = users.filter((u) => [u.name, u.nickname, u.number].some((v) => (v || "").toLocaleLowerCase().includes(q)));
        popup = { start, end, items: users, index: 0 };
        render();
      } catch (e) {
        if (request === revision) {
          hide();
          toast2(e.message);
        }
      }
    }
    function changed() {
      var _a;
      reconcile();
      if (!group() || ((_a = input()) == null ? void 0 : _a.disabled)) {
        hide();
        return;
      }
      const el = input(), caret = el.selectionStart;
      if (caret !== el.selectionEnd) {
        hide();
        return;
      }
      const d = state();
      if (d.spans.some((m) => m.start < caret && m.end >= caret)) {
        hide();
        return;
      }
      const match = el.value.slice(0, caret).match(/@([^@\s]{0,32})$/u);
      if (match) show(caret - match[0].length, caret, match[1]);
      else hide();
    }
    function choose(user) {
      var _a;
      const el = input(), p = popup;
      if (!el || !p || !user) return;
      const label = "@" + (user.nickname || user.name), start = p.start, end = p.end;
      el.value = el.value.slice(0, start) + label + " " + el.value.slice(end);
      reconcile();
      state().spans.push({ userId: user.id, start, end: start + label.length });
      state().spans.sort((a, b) => a.start - b.start);
      hide();
      el.focus();
      el.setSelectionRange(start + label.length + 1, start + label.length + 1);
      (_a = el.oninput) == null ? void 0 : _a.call(el);
      hide();
    }
    function key(e) {
      if (!popup || e.isComposing) return false;
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        if (popup.items.length) popup.index = (popup.index + (e.key === "ArrowDown" ? 1 : -1) + popup.items.length) % popup.items.length;
        render();
        return true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        choose(popup.items[popup.index]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return true;
      }
      return false;
    }
    function open() {
      const el = input();
      if (!el || el.disabled) return;
      show(el.selectionStart, el.selectionEnd);
    }
    async function mentionUser(id) {
      try {
        const c = await members(), u = c.members.find((u2) => u2.id === id);
        if (!u) throw Error("该成员已离开群聊");
        const el = input();
        if (!el || el.disabled) return;
        popup = { start: el.selectionStart, end: el.selectionEnd, items: [u], index: 0 };
        choose(u);
      } catch (e) {
        toast2(e.message);
      }
    }
    function text(m) {
      var _a;
      if (!((_a = m.mentions) == null ? void 0 : _a.length)) return esc2(m.text);
      let at = 0, out = "";
      for (const span of m.mentions) {
        if (span.start < at || span.end > m.text.length) continue;
        out += esc2(m.text.slice(at, span.start)) + '<span class="message-mention">'.concat(esc2(m.text.slice(span.start, span.end)), "</span>");
        at = span.end;
      }
      return out + esc2(m.text.slice(at));
    }
    function applies(m) {
      var _a, _b;
      return m.sender !== ((_a = S2.user) == null ? void 0 : _a.id) && !m.recalled && (m.mentionRecipients || []).includes((_b = S2.user) == null ? void 0 : _b.id);
    }
    function mount() {
      hide();
      reconcile();
      const el = input();
      el == null ? void 0 : el.setAttribute("aria-controls", "mention-picker");
      el == null ? void 0 : el.addEventListener("compositionend", () => changed());
      const target = $2("#mention-jump");
      if (target && (pending == null ? void 0 : pending.cid) === S2.active) {
        target.innerHTML = '<button data-mention="jump">有人 @我 · 查看消息 ↑</button>';
      }
    }
    function select(cid) {
      hide();
      cache = null;
      const c = S2.conversations.find((x) => x.id === cid);
      pending = (c == null ? void 0 : c.firstMentionId) ? { cid, id: c.firstMentionId } : null;
    }
    function clear(cid) {
      drafts.delete(cid);
      hide();
    }
    function reset() {
      drafts.clear();
      pending = null;
      cache = null;
      hide();
    }
    function invalidated(id) {
      var _a;
      if ((pending == null ? void 0 : pending.id) === id) {
        pending = null;
        (_a = $2("#mention-jump")) == null ? void 0 : _a.replaceChildren();
      }
    }
    document.addEventListener("click", (e) => {
      var _a;
      const b = e.target.closest("[data-mention],[data-mention-user]");
      if (b) {
        if (b.dataset.mention === "open") open();
        if (b.dataset.mentionUser) mentionUser(b.dataset.mentionUser);
        if (b.dataset.mention === "jump" && pending) {
          const p = pending;
          pending = null;
          (_a = $2("#mention-jump")) == null ? void 0 : _a.replaceChildren();
          jump(p.cid, p.id).catch((e2) => toast2(e2.message));
        }
      } else if (!e.target.closest("#mention-picker,#composer")) hide();
    });
    return { restore: (cid, text2, spans = []) => drafts.set(cid, { text: text2, spans: spans.map((m) => __spreadValues({}, m)) }), changed, key, mount, select, clear, reset, invalidated, text, applies, failed: () => {
      cache = null;
    }, payload: () => reconcile().spans, tool: () => group() ? '<button type="button" class="icon-btn mention-tool" title="@成员" aria-label="@成员" data-mention="open">@</button>' : "", menu: (m) => group() && m.sender !== S2.user.id ? '<button data-mention-user="'.concat(m.sender, '">@TA</button>') : "" };
  }

  // internal/ui/src/contacts.js
  function createContacts({ S: S2, api: api2, action: action2, modal: showModal, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, av: av2, refresh: refresh2, renderSidebar: renderSidebar2, renderMain: renderMain2, stopMedia, requestFriend: requestFriend2, contextMenu: contextMenu2 }) {
    const $2 = (s) => document.querySelector(s), title = (u) => u.remark || u.name;
    const modal2 = (...args) => {
      var _a;
      showModal(...args);
      (_a = $2(".modal")) == null ? void 0 : _a.classList.add("contacts-modal");
    };
    function bind(id, fn) {
      const b = $2("#" + id);
      if (b) b.onclick = async () => {
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          error(e);
        } finally {
          b.disabled = false;
        }
      };
    }
    const error = (e) => {
      const n = $2("#modal-error");
      if (n) n.textContent = e.message;
      else toast2(e.message);
    };
    function collapsed() {
      try {
        return new Set(JSON.parse(localStorage.getItem("welink_contact_groups_" + S2.user.id) || "[]"));
      } catch (e) {
        return /* @__PURE__ */ new Set();
      }
    }
    function badge(u) {
      return (u == null ? void 0 : u.specialCare) ? '<span class="contact-attention-badge" role="img" aria-label="特别关心" title="特别关心">' + icon2("star") + "</span>" : "";
    }
    function sidebar() {
      const closed = collapsed(), q = S2.search.toLowerCase(), recent = new Set(S2.conversations.filter((c) => c.kind === "direct").map((c) => {
        var _a;
        return (_a = c.peer) == null ? void 0 : _a.id;
      })), peopleSource = q ? S2.friends : S2.friends.filter((u) => recent.has(u.id)), care = S2.friends.filter((u) => u.specialCare);
      const matches = (u) => (u.name + (u.remark || "") + u.account + u.number + u.id + (u.note || "")).toLowerCase().includes(q);
      const groups2 = [{ id: "special-care", name: "特别关心", people: care }, ...[{ id: "", name: "最近联系人" }, ...S2.contactGroups].map((g) => __spreadProps(__spreadValues({}, g), { people: peopleSource.filter((u) => (u.contactGroupId || "") === g.id) }))];
      let found = 0;
      const folders = groups2.map((g) => {
        const people = g.people.filter(matches), hidden = !q && closed.has(g.id);
        found += people.length;
        if (q && !people.length) return "";
        return '<section class="contact-folder-section" data-contact-folder="'.concat(g.id, '"><button class="contact-folder ').concat(hidden ? "collapsed" : "", '" data-contact="toggle" data-group-id="').concat(g.id, '" aria-expanded="').concat(!hidden, '">').concat(icon2("down"), "<b>").concat(esc2(g.name), "</b><small>").concat(people.filter((u) => u.online).length, "/").concat(g.people.length, "</small></button>").concat(hidden ? "" : people.map((u) => '<button class="conversation-row contact-row" data-profile="'.concat(u.id, '">').concat(av2(u, "", true), '<div class="row-text"><div class="row-title"><b>').concat(esc2(title(u)), "</b>").concat(badge(u), '</div><div class="row-preview"><span>').concat(esc2(u.bio || (u.online ? "[在线]" : "[离线]")), "</span></div></div></button>")).join("")).concat(!hidden && !q && g.id === "special-care" && !people.length ? '<p class="contact-attention-empty">在联系人设置中添加特别关心</p>' : "", "</section>");
      }).join("");
      const self = matches(S2.user) ? '<section class="contact-folder-section self-contact"><button class="conversation-row contact-self-row" data-profile="' + S2.user.id + '">' + av2(__spreadProps(__spreadValues({}, S2.user), { online: !S2.offline }), "", true) + '<div class="row-text"><div class="row-title"><b>' + esc2(S2.user.name) + '（我）</b></div><div class="row-preview">' + (S2.offline ? "离线" : "在线") + " · " + esc2(S2.user.number) + "</div></div></button></section>" : "";
      return self + '<button class="contact-manage-link" data-contact="groups">' + icon2("settings") + "分组管理</button>" + folders + (!q && !peopleSource.length && !care.length ? '<div class="empty-list">还没有最近联系人<br>搜索用户，直接开始聊天</div>' : q && !found && !self ? '<div class="empty-list">没有找到用户</div>' : "");
    }
    function profile2(u) {
      return "".concat(av2(u, "large", true), "<h2>").concat(esc2(title(u))).concat(badge(u), "</h2>").concat(u.remark ? '<span class="profile-line">姓名：' + esc2(u.name) + "</span>" : "", '<span class="profile-line">LinkMe 账号：').concat(esc2(u.number || u.account), '</span><dl class="profile-details"><dt>手机号</dt><dd>').concat(esc2(u.phone || "未设置"), "</dd><dt>性别</dt><dd>").concat(esc2({ male: "男", female: "女", other: "其他" }[u.gender] || "未设置"), "</dd><dt>职位</dt><dd>").concat(esc2(u.jobTitle || "未设置"), '</dd></dl><p class="profile-bio">').concat(esc2(u.bio || "这个人很酷，还没有写签名。"), "</p>").concat(u.note ? '<p class="contact-private-note">' + esc2(u.note) + "</p>" : "", '<div class="contact-profile-actions">').concat(u.id === S2.user.id ? '<button class="primary" data-action="profile">编辑资料</button>' : '<button class="primary" data-start-chat="'.concat(u.id, '">发消息</button><button class="secondary" data-user-call="').concat(u.id, '" data-user-call-mode="audio">语音通话</button><button class="secondary" data-user-call="').concat(u.id, '" data-user-call-mode="video">视频通话</button><button class="secondary" data-contact="attention" data-user="').concat(u.id, '">').concat(u.specialCare ? "取消特别关心" : "设为特别关心", '</button><button class="secondary" data-contact="messages" data-user="').concat(u.id, '">').concat(u.messageBlocked ? "取消屏蔽" : "屏蔽私聊消息", '</button><button class="secondary" data-contact="edit" data-user="').concat(u.id, '">联系人设置</button>'), "</div>");
    }
    async function edit(id) {
      const detail = await api2("/api/contacts/" + id), u = detail.user;
      if (!detail.friend) {
        modal2("联系人资料", '<div class="contact-person">'.concat(av2(u, "large"), "<h3>").concat(esc2(u.name), "</h3><p>LinkMe 号 ").concat(esc2(u.number), '</p></div><p class="hint">').concat(detail.blocked ? "你已将该用户加入黑名单。" : "你们还不是好友。", "</p>"), detail.blocked ? '<button class="primary" id="contact-unblock">解除拉黑</button>' : detail.canAdd ? '<button class="primary" id="contact-add">添加好友</button>' : "");
        bind("contact-unblock", async () => {
          await api2("/api/contact-blocks/" + id, { method: "DELETE" });
          await refresh2();
          await edit(id);
        });
        bind("contact-add", () => requestFriend2(id, u.name));
        return;
      }
      modal2("联系人设置", '<div class="contact-person compact">'.concat(av2(u), "<div><h3>").concat(esc2(title(u)), "</h3><p>LinkMe 号 ").concat(esc2(u.number), '</p></div></div><label for="contact-remark">备注名称</label><input id="contact-remark" maxlength="32" value="').concat(esc2(u.remark || ""), '" placeholder="').concat(esc2(u.name), '"><label for="contact-folder">联系人分组</label><select id="contact-folder"><option value="">最近联系人</option>').concat(S2.contactGroups.map((g) => '<option value="'.concat(g.id, '" ').concat(g.id === u.contactGroupId ? "selected" : "", ">").concat(esc2(g.name), "</option>")).join(""), '</select><label for="contact-note">描述</label><textarea id="contact-note" maxlength="200" placeholder="仅自己可见的备注信息">').concat(esc2(u.note || ""), '</textarea><p class="hint">备注、分组和描述仅自己可见，会同步到你的其他设备。</p><label class="check-row"><span>特别关心</span><input type="checkbox" id="contact-special-care" ').concat(u.specialCare ? "checked" : "", '></label><p class="hint">在联系人中单独分组，仅自己可见，并同步到其他设备。</p><label class="check-row"><span>屏蔽 TA 的私聊消息</span><input type="checkbox" id="contact-message-blocked" ').concat(detail.messageBlocked ? "checked" : "", '></label><p class="hint">屏蔽期间，对方无法向你发送私聊消息。历史记录保留，取消屏蔽后恢复接收。</p><div class="contact-danger-actions"><button data-contact="delete" data-user="').concat(id, '">从列表移除</button><button data-contact="block" data-user="').concat(id, '">加入黑名单</button></div>'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="contact-save">保存</button>');
      bind("contact-save", async () => {
        await api2("/api/contacts/" + id, { method: "PATCH", body: { remark: $2("#contact-remark").value, groupId: $2("#contact-folder").value, note: $2("#contact-note").value, specialCare: $2("#contact-special-care").checked, messageBlocked: $2("#contact-message-blocked").checked } });
        closeModal2();
        await refresh2();
        toast2("联系人设置已保存");
      });
    }
    function confirmRemove(id, block) {
      var _a;
      const u = S2.friends.find((u2) => u2.id === id) || ((_a = S2.conversations.find((c) => {
        var _a2;
        return ((_a2 = c.peer) == null ? void 0 : _a2.id) === id;
      })) == null ? void 0 : _a.peer) || { name: "该用户" };
      modal2(block ? "加入黑名单" : "从列表移除", '<p class="contact-confirm">确定'.concat(block ? "拉黑" : "移除", " ").concat(esc2(title(u)), '？</p><p class="hint">').concat(block ? "不再接收对方的私聊，双方的远程协助和单聊会议会结束。" : "从列表移除并取消特别关心，聊天记录和备注保留。下次收发消息时会重新显示。", "</p>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="contact-remove-confirm">确定</button>');
      bind("contact-remove-confirm", async () => {
        await api2((block ? "/api/contact-blocks/" : "/api/contacts/") + id, { method: block ? "POST" : "DELETE", body: block ? {} : void 0 });
        closeModal2();
        await refresh2();
        toast2(block ? "已加入黑名单" : "已从列表移除");
      });
    }
    async function groups() {
      await refresh2();
      modal2("联系人分组", '<div class="contact-group-item"><span>最近联系人</span><small>默认分组</small></div>'.concat(S2.contactGroups.map((g, i) => '<div class="contact-group-item"><span>'.concat(esc2(g.name), "<small>").concat(g.count, ' 位联系人</small></span><button data-contact="group-up" data-group-id="').concat(g.id, '" ').concat(i === 0 ? "disabled" : "", ' title="上移">↑</button><button data-contact="group-down" data-group-id="').concat(g.id, '" ').concat(i === S2.contactGroups.length - 1 ? "disabled" : "", ' title="下移">↓</button><button data-contact="group-edit" data-group-id="').concat(g.id, '">重命名</button><button data-contact="group-delete" data-group-id="').concat(g.id, '" class="danger">删除</button></div>')).join(""), '<p class="hint">删除分组会将其中好友移到“最近联系人”，保留备注和描述。</p>'), '<button class="secondary" data-action="close-modal">完成</button><button class="primary" data-contact="group-create">新建分组</button>', true);
    }
    function groupForm(id) {
      const g = S2.contactGroups.find((x) => x.id === id);
      modal2(g ? "重命名分组" : "新建分组", '<label for="contact-group-name">分组名称</label><input id="contact-group-name" maxlength="24" placeholder="例如：同事、家人" value="' + esc2((g == null ? void 0 : g.name) || "") + '">', '<button class="secondary" data-contact="groups">取消</button><button class="primary" id="contact-group-save">保存</button>');
      bind("contact-group-save", async () => {
        await api2("/api/contact-groups" + (g ? "/" + g.id : ""), { method: g ? "PATCH" : "POST", body: { name: $2("#contact-group-name").value } });
        await groups();
      });
      $2("#contact-group-name").focus();
    }
    async function moveGroup(id, delta) {
      const order = S2.contactGroups.map((g) => g.id), i = order.indexOf(id), to = i + delta;
      if (i < 0 || to < 0 || to >= order.length) return;
      [order[i], order[to]] = [order[to], order[i]];
      await action2("/api/contact-groups/order", { ids: order });
      await groups();
    }
    async function blocks() {
      const list = await api2("/api/contact-blocks");
      modal2("黑名单", '<p class="hint">解除拉黑后可以再次直接聊天。</p>'.concat(list.map((u) => '<div class="contact-block-row">'.concat(av2(u), "<span><b>").concat(esc2(u.name), "</b><small>").concat(esc2(u.number), '</small></span><button class="secondary" data-contact="unblock" data-user="').concat(u.id, '">解除</button></div>')).join("") || '<p class="empty-list">黑名单为空</p>'), '<button class="secondary" data-contact="privacy">返回</button>');
    }
    async function privacy() {
      modal2("联系人设置", '<p class="hint">不需要添加或批准好友。通过姓名、号码或用户 ID 搜索即可聊天；从列表移除后仍保留聊天记录。</p><button class="contact-settings-row" data-contact="blocks">黑名单' + icon2("chevron") + '</button><button class="contact-settings-row" data-contact="groups">联系人分组' + icon2("chevron") + "</button>", '<button class="primary" data-action="close-modal">完成</button>');
    }
    function syncComposer() {
      var _a;
      const c = S2.conversations.find((c2) => c2.id === S2.active), composer = $2(".composer");
      if (!composer) return;
      const blocked = (c == null ? void 0 : c.kind) === "direct" && c.canSend === false, was = composer.classList.contains("contact-unavailable");
      if (blocked && !was) stopMedia();
      composer.classList.toggle("contact-unavailable", blocked);
      let banner = $2("#contact-unavailable-banner");
      if (!banner) {
        composer.insertAdjacentHTML("beforeend", '<div id="contact-unavailable-banner" class="contact-unavailable-banner"></div>');
        banner = $2("#contact-unavailable-banner");
      }
      ;
      banner.innerHTML = blocked ? '<span>当前无法私聊，请检查黑名单或账号状态。</span><button data-contact="edit" data-user="'.concat(c.peer.id, '">查看联系人</button>') : "";
      if (blocked || was) $2("#composer").disabled = blocked;
      if ((c == null ? void 0 : c.kind) === "direct" && $2(".chat-head h2")) $2(".chat-head h2").innerHTML = esc2(c.name) + badge(c.peer) + '<small id="typing-status">'.concat(((_a = c.peer) == null ? void 0 : _a.online) ? "在线" : "离线", "</small>");
    }
    function menu(id, x, y) {
      const u = S2.friends.find((u2) => u2.id === id);
      contextMenu2(x, y, '<button data-create-group-user="'.concat(id, '">创建群聊</button><button data-contact="attention" data-user="').concat(id, '">').concat((u == null ? void 0 : u.specialCare) ? "取消特别关心" : "设为特别关心", '</button><button data-contact="edit" data-user="').concat(id, '">备注与分组</button><button data-contact="delete" data-user="').concat(id, '">从列表移除</button><button data-contact="block" data-user="').concat(id, '">加入黑名单</button>'));
    }
    document.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".contact-row[data-profile]");
      if (row) {
        e.preventDefault();
        menu(row.dataset.profile, e.clientX, e.clientY);
      }
    });
    bindLongPress(".contact-row[data-profile]", (row, x, y) => menu(row.dataset.profile, x, y));
    document.addEventListener("click", async (e) => {
      var _a, _b, _c;
      const b = e.target.closest("[data-contact]");
      if (!b || !S2.user) return;
      try {
        switch (b.dataset.contact) {
          case "attention": {
            b.disabled = true;
            const owner2 = S2.user.id;
            try {
              const detail = await api2("/api/contacts/" + b.dataset.user);
              if (((_a = S2.user) == null ? void 0 : _a.id) !== owner2) break;
              await api2("/api/contacts/" + b.dataset.user, { method: "PATCH", body: { specialCare: !detail.user.specialCare } });
              if (((_b = S2.user) == null ? void 0 : _b.id) !== owner2) break;
              await refresh2();
              toast2(detail.user.specialCare ? "已取消特别关心" : "已设为特别关心");
            } finally {
              b.disabled = false;
            }
            break;
          }
          case "messages": {
            const id = b.dataset.user, detail = await api2("/api/contacts/" + id), blocked = !detail.messageBlocked;
            await api2("/api/contacts/" + id, { method: "PATCH", body: { messageBlocked: blocked } });
            await refresh2();
            if (((_c = S2.profile) == null ? void 0 : _c.id) === id) {
              S2.profile.messageBlocked = blocked;
              renderMain2();
            }
            toast2(blocked ? "已屏蔽此人的私聊消息" : "已取消屏蔽");
            break;
          }
          case "edit":
            await edit(b.dataset.user);
            break;
          case "delete":
            confirmRemove(b.dataset.user, false);
            break;
          case "block":
            confirmRemove(b.dataset.user, true);
            break;
          case "groups":
            await groups();
            break;
          case "group-create":
            groupForm();
            break;
          case "group-edit":
            groupForm(b.dataset.groupId);
            break;
          case "group-up":
            await moveGroup(b.dataset.groupId, -1);
            break;
          case "group-down":
            await moveGroup(b.dataset.groupId, 1);
            break;
          case "group-delete": {
            const g = S2.contactGroups.find((g2) => g2.id === b.dataset.groupId);
            modal2("删除分组", '<p class="contact-confirm">确定删除 ' + esc2(g.name) + "？好友会移入默认分组。</p>", '<button class="secondary" data-contact="groups">取消</button><button class="primary" id="contact-group-delete">确定</button>');
            bind("contact-group-delete", async () => {
              await api2("/api/contact-groups/" + g.id, { method: "DELETE" });
              await groups();
            });
            break;
          }
          case "toggle": {
            const list = collapsed(), id = b.dataset.groupId;
            if (list.has(id)) list.delete(id);
            else list.add(id);
            localStorage.setItem("welink_contact_groups_" + S2.user.id, JSON.stringify([...list]));
            renderSidebar2();
            break;
          }
          case "privacy":
            await privacy();
            break;
          case "blocks":
            await blocks();
            break;
          case "unblock":
            b.disabled = true;
            await api2("/api/contact-blocks/" + b.dataset.user, { method: "DELETE" });
            await refresh2();
            await blocks();
            break;
        }
      } catch (e2) {
        error(e2);
      }
    });
    return { sidebar, profile: profile2, edit, privacy, syncComposer, badge };
  }

  // internal/ui/src/groups.js
  function createGroups({ S: S2, api: api2, action: action2, modal: showModal, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, av: av2, refresh: refresh2, selectConversation: selectConversation2, renderMain: renderMain2, copy, stopMedia }) {
    const $2 = (s) => document.querySelector(s), roles = { owner: "群主", admin: "管理员", member: "成员" }, modes = { open: "允许任何人加入", approval: "需要管理员审核", closed: "不允许申请加入" };
    let detailState = null, searchVersion = 0, muteTimer;
    const modal2 = (...args) => {
      var _a;
      showModal(...args);
      (_a = $2(".modal")) == null ? void 0 : _a.classList.add("group-modal");
    };
    const manager = (g) => (g == null ? void 0 : g.role) === "owner" || (g == null ? void 0 : g.role) === "admin";
    const error = (e) => {
      const n = $2("#modal-error");
      if (n) n.textContent = e.message;
      else toast2(e.message);
    };
    function bind(id, fn) {
      const b = $2("#" + id);
      if (!b) return;
      b.onclick = async () => {
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          error(e);
        } finally {
          b.disabled = false;
        }
      };
    }
    const back = () => detailState && detail(detailState.id);
    function row(label, text, act) {
      return '<button class="group-setting-row" data-group="'.concat(act, '"><span>').concat(label, "</span><small>").concat(text || "", "</small>").concat(icon2("chevron"), "</button>");
    }
    async function detail(cid = S2.active) {
      var _a;
      const c = await api2("/api/conversations/" + cid);
      if (c.kind !== "group") return;
      detailState = c;
      const g = c.group, local = S2.conversations.find((x) => x.id === cid) || {}, me = c.members.find((x) => x.id === S2.user.id);
      modal2("群聊设置", '<div class="group-summary">'.concat(manager(g) ? '<button class="group-avatar-link" data-avatar="group" data-group-id="' + c.id + '" aria-label="更换群头像">' : "").concat(av2({ kind: "group", avatar: g.avatar || "group", name: c.name }, "large")).concat(manager(g) ? "</button>" : "", "<div><h3>").concat(esc2(c.name), "</h3><p>群号 ").concat(esc2(g.number), ' <button class="group-link" data-group="copy-number">复制</button></p><small>').concat(g.count, " 人 · ").concat(roles[g.role], '</small></div></div><div class="group-member-grid">').concat(c.members.slice(0, 9).map((u) => '<button data-group-user="'.concat(u.id, '">').concat(av2(u), "<span>").concat(esc2(u.nickname || u.name), "</span>").concat(u.role !== "member" ? '<small class="group-role '.concat(u.role, '">').concat(roles[u.role], "</small>") : "", "</button>")).join("")).concat(manager(g) || g.membersInvite ? '<button data-group="invite" class="group-add-member">' + icon2("plus") + "<span>邀请</span></button>" : "", "</div>").concat(row("群聊成员", g.count + " 人", "members")).concat(row("群公告", esc2(((_a = c.announcement) == null ? void 0 : _a.slice(0, 24)) || "暂无公告"), "announcement")).concat(row("我的群名片", esc2((me == null ? void 0 : me.nickname) || (me == null ? void 0 : me.name) || ""), "my-card")).concat(manager(g) ? row("群管理", "入群方式、管理员、禁言", "manage") + row("加群申请", (S2.groupRequests || []).filter((x) => x.conversationId === cid && x.canReview && x.status === "pending").length + " 条待处理", "requests") : "").concat(row("查找聊天记录", "", "history"), '<label class="prefs-row">置顶聊天<input type="checkbox" id="group-pin" ').concat(local.pinned ? "checked" : "", '></label><label class="prefs-row">消息免打扰<input type="checkbox" id="group-notifications" ').concat(local.muted ? "checked" : "", '></label><p class="hint">').concat(esc2(g.description || "暂无群介绍"), '</p><button class="chat-remove-entry" data-conversation-action="remove" data-cid="').concat(c.id, '">').concat(icon2("trash"), '从消息列表移除</button><button class="group-danger" data-group="').concat(g.role === "owner" ? "dissolve" : "leave", '">').concat(g.role === "owner" ? "解散该群" : "退出该群", "</button>"), '<button class="primary" id="group-save-prefs">完成</button>', true);
      bind("group-save-prefs", async () => {
        await api2("/api/conversations/" + cid, { method: "PATCH", body: { pinned: $2("#group-pin").checked, muted: $2("#group-notifications").checked } });
        closeModal2();
        await refresh2();
      });
    }
    async function members() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      modal2("群聊成员 · " + c.members.length, '<input id="group-member-search" placeholder="搜索群成员或号码" aria-label="搜索群成员"><div id="group-members-list"></div>', '<button class="secondary" data-group="back">返回</button>', true);
      const render = () => {
        const q = $2("#group-member-search").value.toLowerCase();
        $2("#group-members-list").innerHTML = c.members.filter((u) => (u.name + u.nickname + u.number).toLowerCase().includes(q)).map((u) => '<button class="group-person-row" data-group-user="'.concat(u.id, '">').concat(av2(u), "<span><b>").concat(esc2(u.nickname || u.name), "</b><small>").concat(esc2(u.number)).concat(u.muteUntil > Date.now() ? " · 禁言中" : "", '</small></span><i class="group-role ').concat(u.role, '">').concat(roles[u.role], "</i>").concat(icon2("chevron"), "</button>")).join("") || '<p class="hint">没有找到成员</p>';
      };
      $2("#group-member-search").oninput = render;
      render();
    }
    async function member(id) {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      const u = c.members.find((x) => x.id === id);
      if (!u) {
        toast2("该成员已退出群聊");
        return;
      }
      ;
      const g = c.group, self = id === S2.user.id, canManage = manager(g) && !self && u.role !== "owner" && (g.role === "owner" || u.role !== "admin"), canCard = self || canManage;
      modal2("群成员资料", '<div class="group-summary">'.concat(av2(u, "large"), "<div><h3>").concat(esc2(u.name), "</h3><p>LinkMe 号 ").concat(esc2(u.number), '</p><span class="group-role ').concat(u.role, '">').concat(roles[u.role], '</span></div></div><label for="group-member-card">群名片</label><input id="group-member-card" maxlength="32" value="').concat(esc2(u.nickname || ""), '" placeholder="').concat(esc2(u.name), '" ').concat(canCard ? "" : "disabled", ">").concat(canManage ? '<label for="group-member-mute">禁言</label><select id="group-member-mute"><option value="">保持当前状态</option><option value="0">解除禁言</option><option value="10">10 分钟</option><option value="60">1 小时</option><option value="1440">1 天</option><option value="43200">30 天</option></select><p class="hint">'.concat(u.muteUntil > Date.now() ? "禁言至 " + esc2(new Date(u.muteUntil).toLocaleString()) : "当前未禁言", "</p>") : "").concat(g.role === "owner" && !self ? '<label class="prefs-row">设为管理员<input type="checkbox" id="group-member-admin" '.concat(u.role === "admin" ? "checked" : "", "></label>") : "").concat(canManage ? '<button class="group-danger" id="group-remove-member">移出群聊</button>' : ""), '<button class="secondary" data-group="members">返回成员列表</button>' + (canCard ? '<button class="primary" id="group-member-save">保存</button>' : ""));
      bind("group-member-save", async () => {
        var _a;
        const p = { nickname: $2("#group-member-card").value };
        if ($2("#group-member-admin") && $2("#group-member-admin").checked !== (u.role === "admin")) p.admin = $2("#group-member-admin").checked;
        if ((_a = $2("#group-member-mute")) == null ? void 0 : _a.value) p.muteMinutes = Number($2("#group-member-mute").value);
        await api2("/api/groups/".concat(c.id, "/members/").concat(id), { method: "PATCH", body: p });
        toast2("已更新群成员");
        await refresh2();
        await members();
      });
      bind("group-remove-member", () => confirm("移出群聊", "确定将 " + esc2(u.nickname || u.name) + " 移出群聊？", async () => {
        await api2("/api/conversations/".concat(c.id, "/members/").concat(id), { method: "DELETE" });
        await refresh2();
        await members();
      }));
    }
    async function manage() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      const g = c.group;
      if (!manager(g)) throw Error("你已没有群管理权限");
      modal2("群管理", '<label for="group-edit-name">群名称</label><input id="group-edit-name" value="'.concat(esc2(c.name), '" maxlength="60"><label for="group-description">群介绍</label><textarea id="group-description" maxlength="200" placeholder="向搜索到群的人介绍一下">').concat(esc2(g.description), '</textarea><label class="prefs-row">允许通过群号或名称搜索<input type="checkbox" id="group-discoverable" ').concat(g.discoverable ? "checked" : "", '></label><label for="group-join-mode">搜索入群方式</label><select id="group-join-mode">').concat(Object.entries(modes).map(([v, t]) => '<option value="'.concat(v, '" ').concat(g.joinMode === v ? "selected" : "", ">").concat(t, "</option>")).join(""), '</select><label class="prefs-row">允许成员邀请好友<input type="checkbox" id="group-members-invite" ').concat(g.membersInvite ? "checked" : "", '></label><label class="prefs-row">全员禁言<input type="checkbox" id="group-all-muted" ').concat(g.allMuted ? "checked" : "", '></label><p class="hint">全员禁言时，群主和管理员仍可发言。成员邀请会直接拉人入群，不需要再次申请。</p>').concat(row("设置管理员", "在成员资料中设置，最多 10 人", "members")).concat(g.role === "owner" ? row("转让群主", "", "transfer") : ""), '<button class="secondary" data-group="back">返回</button><button class="primary" id="group-manage-save">保存</button>', true);
      bind("group-manage-save", async () => {
        await api2("/api/groups/" + c.id, { method: "PATCH", body: { name: $2("#group-edit-name").value, description: $2("#group-description").value, discoverable: $2("#group-discoverable").checked, joinMode: $2("#group-join-mode").value, membersInvite: $2("#group-members-invite").checked, allMuted: $2("#group-all-muted").checked } });
        await refresh2();
        toast2("群管理设置已保存");
        await detail(c.id);
      });
    }
    function confirm(title, text, fn) {
      modal2(title, '<p class="group-confirm">'.concat(text, "</p>"), '<button class="secondary" data-group="back">取消</button><button class="primary" id="group-confirm">确定</button>');
      bind("group-confirm", fn);
    }
    async function transfer() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      modal2("转让群主", '<p class="hint">转让后，你将成为普通成员。请选择新群主。</p><div class="member-select">' + c.members.filter((u) => u.id !== S2.user.id).map((u) => '<button class="group-person-row" data-group-transfer="'.concat(u.id, '">').concat(av2(u), "<span><b>").concat(esc2(u.nickname || u.name), "</b><small>").concat(roles[u.role], "</small></span>").concat(icon2("chevron"), "</button>")).join("") + "</div>", '<button class="secondary" data-group="manage">取消</button>');
    }
    async function invite() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      const list = S2.friends.filter((u) => !c.members.some((m) => m.id === u.id));
      modal2("邀请好友入群", '<p class="hint">选择一位或多位用户，直接加入群聊</p><div class="member-select">'.concat(list.map((u) => '<label class="check-row">'.concat(av2(u)).concat(esc2(u.name), '<input type="checkbox" name="group-invite" value="').concat(u.id, '"></label>')).join("") || '<p class="hint">好友都已在群里</p>', "</div>"), '<button class="secondary" data-group="back">取消</button><button class="primary" id="group-invite-send">邀请</button>');
      bind("group-invite-send", async () => {
        const result = await action2("/api/conversations/" + c.id + "/members", { members: [...document.querySelectorAll("[name=group-invite]:checked")].map((x) => x.value) });
        await refresh2();
        await detail(c.id);
      });
    }
    async function announcement() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      modal2("群公告", '<textarea id="group-announcement" maxlength="2000" placeholder="暂无群公告" '.concat(manager(c.group) ? "" : "readonly", ">").concat(esc2(c.announcement), "</textarea>"), '<button class="secondary" data-group="back">返回</button>' + (manager(c.group) ? '<button class="primary" id="group-announcement-save">发布</button>' : ""));
      bind("group-announcement-save", async () => {
        await api2("/api/groups/" + c.id, { method: "PATCH", body: { announcement: $2("#group-announcement").value } });
        await refresh2();
        toast2("群公告已发布");
        await detail(c.id);
      });
    }
    async function requests() {
      const list = await api2("/api/group-requests");
      S2.groupRequests = list;
      const status = { pending: "等待审核", accepted: "已同意", rejected: "已拒绝", cancelled: "群已解散" };
      modal2("群通知", '<div class="group-requests">'.concat(list.map((q) => '<article class="group-request">'.concat(av2(q), "<div><b>").concat(esc2(q.name), "</b><p>").concat(q.inviter ? esc2(q.inviterName) + " 邀请加入" : "申请加入", " ").concat(esc2(q.groupName), "</p><small>群号 ").concat(esc2(q.number), '</small><p class="hint">').concat(esc2(q.message), "</p>").concat(q.status === "pending" && q.canReview ? '<button class="secondary" data-group-review="'.concat(q.id, '" data-accept="false">拒绝</button><button class="primary" data-group-review="').concat(q.id, '" data-accept="true">同意</button>') : '<span class="group-request-state">'.concat(status[q.status] || q.status, "</span>"), "</div></article>")).join("") || '<p class="hint">暂无群通知</p>', "</div>"), "", true);
    }
    function search() {
      const revision = ++searchVersion;
      let requestVersion = 0;
      modal2("查找群聊", '<form id="group-search-form" class="group-search-form"><input id="group-search-query" placeholder="输入群号或群名称" aria-label="搜索群聊" maxlength="60"><button class="primary">查找</button></form><div id="group-search-results"><p class="hint">群主开启搜索后，可通过群号或群名称找到群。</p></div>', "", true);
      $2("#group-search-form").onsubmit = async (e) => {
        e.preventDefault();
        const request = ++requestVersion;
        const query = $2("#group-search-query").value.trim(), list = $2("#group-search-results");
        list.innerHTML = '<p class="hint">正在查找…</p>';
        try {
          const results = await api2("/api/groups?q=" + encodeURIComponent(query));
          if (searchVersion !== revision || request !== requestVersion || !document.contains(list)) return;
          list.innerHTML = results.map((g) => '<article class="group-search-result">'.concat(av2({ kind: "group", avatar: g.avatar || "group" }), "<div><b>").concat(esc2(g.name), "</b><p>群号 ").concat(esc2(g.number), " · ").concat(g.count, ' 人</p><p class="hint">').concat(esc2(g.description), "</p><small>").concat(modes[g.joinMode], '</small></div><button class="').concat(g.joined ? "secondary" : "primary", '" data-group-join="').concat(g.id, '" data-joined="').concat(g.joined, '" data-mode="').concat(g.joinMode, '" data-name="').concat(esc2(g.name), '" ').concat(!g.joined && g.joinMode === "closed" ? "disabled" : "", ">").concat(g.joined ? "发消息" : "加入", "</button></article>")).join("") || '<p class="hint">没有找到群聊</p>';
        } catch (e2) {
          if (request === requestVersion && document.contains(list)) list.textContent = e2.message;
        }
      };
      $2("#group-search-query").focus();
    }
    async function join(button) {
      const cid = button.dataset.groupJoin;
      if (button.dataset.joined === "true") {
        closeModal2();
        await selectConversation2(cid);
        return;
      }
      ;
      if (button.dataset.mode === "open") {
        button.disabled = true;
        try {
          await action2("/api/groups/" + cid + "/join");
          closeModal2();
          await refresh2();
          await selectConversation2(cid);
        } finally {
          button.disabled = false;
        }
        return;
      }
      ;
      modal2("申请加入 " + button.dataset.name, '<label for="group-join-message">验证信息</label><textarea id="group-join-message" maxlength="200" placeholder="向群主和管理员介绍一下自己"></textarea>', '<button class="secondary" data-group="search">取消</button><button class="primary" id="group-join-submit">发送申请</button>');
      bind("group-join-submit", async () => {
        const result = await action2("/api/groups/" + cid + "/join", { message: $2("#group-join-message").value });
        await refresh2();
        if (result.status === "joined") {
          closeModal2();
          await selectConversation2(cid);
        } else {
          modal2("申请已发送", '<p class="hint">等待群主或管理员审核，处理结果会显示在群通知中。</p>', '<button class="primary" data-group="requests">查看群通知</button>');
        }
      });
    }
    function syncComposer() {
      clearTimeout(muteTimer);
      const c = S2.conversations.find((x) => x.id === S2.active), g = c == null ? void 0 : c.group, blocked = g && !manager(g) && (g.allMuted || g.muteUntil > Date.now()), composer = $2(".composer");
      if (!composer) return;
      const wasBlocked = composer.classList.contains("group-muted");
      if (blocked && !wasBlocked) stopMedia();
      composer.classList.toggle("group-muted", !!blocked);
      let banner = $2("#group-muted-banner");
      if (!banner) {
        composer.insertAdjacentHTML("beforeend", '<div id="group-muted-banner" class="group-muted-banner"></div>');
        banner = $2("#group-muted-banner");
      }
      ;
      banner.textContent = blocked ? g.allMuted ? "全员禁言中，仅群主和管理员可发言" : "你已被禁言至 " + new Date(g.muteUntil).toLocaleString("zh-CN", { hour12: false }) : "";
      if (blocked && !g.allMuted) muteTimer = setTimeout(syncComposer, Math.min(6e4, Math.max(50, g.muteUntil - Date.now() + 50)));
      if (blocked || wasBlocked) $2("#composer").disabled = !!blocked;
      const header = $2(".chat-head h2");
      if (c && header && c.kind === "group") header.innerHTML = esc2(c.name) + '<small id="typing-status">'.concat((g == null ? void 0 : g.count) || "", " 人 · 群号 ").concat(esc2((g == null ? void 0 : g.number) || ""), "</small>");
    }
    document.addEventListener("click", async (e) => {
      var _a;
      const b = e.target.closest("[data-group],[data-group-user],[data-group-review],[data-group-join],[data-group-transfer]");
      if (!b || !S2.user) return;
      try {
        if (b.dataset.groupUser) {
          await member(b.dataset.groupUser);
          return;
        }
        ;
        if (b.dataset.groupReview) {
          b.disabled = true;
          try {
            await action2("/api/group-requests/" + b.dataset.groupReview, { accept: b.dataset.accept === "true" });
            await refresh2();
            await requests();
          } finally {
            b.disabled = false;
          }
          ;
          return;
        }
        ;
        if (b.dataset.groupJoin) {
          await join(b);
          return;
        }
        ;
        if (b.dataset.groupTransfer) {
          const c = detailState, u = c.members.find((u2) => u2.id === b.dataset.groupTransfer);
          confirm("转让群主", "确定将群主转让给 " + esc2(u.nickname || u.name) + "？", async () => {
            await action2("/api/groups/" + c.id + "/transfer", { userId: u.id });
            await refresh2();
            toast2("群主已转让");
            await detail(c.id);
          });
          return;
        }
        switch (b.dataset.group) {
          case "back":
            await back();
            break;
          case "members":
            await members();
            break;
          case "my-card":
            await member(S2.user.id);
            break;
          case "manage":
            await manage();
            break;
          case "announcement":
            await announcement();
            break;
          case "invite":
            await invite();
            break;
          case "transfer":
            await transfer();
            break;
          case "requests":
            await requests();
            break;
          case "search":
            search();
            break;
          case "copy-number":
            await copy(detailState.group.number);
            break;
          case "history":
            closeModal2();
            (_a = document.querySelector(".chat-head [data-action=search-history]")) == null ? void 0 : _a.click();
            break;
          case "leave":
          case "dissolve": {
            const c = detailState, dissolve = b.dataset.group === "dissolve";
            confirm(dissolve ? "解散群聊" : "退出群聊", dissolve ? "解散后所有成员都将失去该群的访问权限，群号不再使用。确定解散 " + esc2(c.name) + "？" : "确定退出 " + esc2(c.name) + "？退出后将无法继续访问群聊记录。", async () => {
              await api2(dissolve ? "/api/groups/" + c.id : "/api/conversations/".concat(c.id, "/members/").concat(S2.user.id), { method: "DELETE" });
              closeModal2();
              await refresh2();
              renderMain2();
              toast2(dissolve ? "群已解散" : "已退出群聊");
            });
            break;
          }
        }
      } catch (e2) {
        error(e2);
      }
    });
    return { detail, search, requests, syncComposer };
  }

  // internal/ui/src/media.js
  function createMedia({ S: S2, api: api2, action: action2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, fileURL: fileURL2, randomID: randomID2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, upload: upload2, enqueue }) {
    const $2 = (s, r = document) => r.querySelector(s);
    const mic = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
    const sound = '<svg class="voice-sound" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 10 4-4v12l-4-4H3v-4Z"/><path d="M13 8a6 6 0 0 1 0 8"/><path d="M17 4a11 11 0 0 1 0 16"/></svg>';
    const seconds = (ms) => Math.max(1, Math.ceil(Number(ms || 0) / 1e3));
    const clock = (ms) => {
      const n = Math.max(0, Math.floor(Number(ms || 0) / 1e3));
      return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
    };
    let mode = false, recording = null, hold = null, videoPlayer = null, playing = null;
    const audio = document.createElement("audio");
    audio.id = "welink-audio-player";
    audio.preload = "none";
    audio.style.display = "none";
    document.body.append(audio);
    function played() {
      var _a;
      try {
        return new Set(JSON.parse(localStorage.getItem("welink_voice_played_" + ((_a = S2.user) == null ? void 0 : _a.id)) || "[]"));
      } catch (e) {
        return /* @__PURE__ */ new Set();
      }
    }
    function markPlayed(id) {
      const ids = played();
      ids.add(id);
      localStorage.setItem("welink_voice_played_" + S2.user.id, JSON.stringify([...ids].slice(-500)));
    }
    function bubble(m, rootID = "") {
      var _a;
      if (m.kind === "voice") return '<button class="voice-message" data-play-voice="'.concat(m.attachmentId, '" data-media-message="').concat(m.id || rootID, '" data-duration="').concat(Number(m.durationMs) || 0, '" aria-label="播放语音 ').concat(seconds(m.durationMs), ' 秒" style="width:').concat(Math.min(220, 95 + Math.sqrt(seconds(m.durationMs)) * 15), 'px">').concat(sound, "<span>").concat(seconds(m.durationMs), "″</span>").concat(m.sender && m.sender !== ((_a = S2.user) == null ? void 0 : _a.id) && !played().has(m.attachmentId) ? '<i class="voice-unplayed"></i>' : "", "</button>");
      return '<button class="video-message" data-play-video="'.concat(m.attachmentId, '" data-media-message="').concat(m.id || rootID, '" data-media-root="').concat(rootID, '" data-media-name="').concat(esc2(m.fileName || "视频"), '" aria-label="播放视频"><video muted playsinline preload="metadata" src="').concat(fileURL2(m.attachmentId), '" tabindex="-1"></video><span class="video-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" style="fill:currentColor;stroke:none"/></svg></span><span class="video-duration">').concat(clock(m.durationMs), "</span></button>");
    }
    function tools() {
      return '<button class="icon-btn" title="语音消息" aria-label="语音消息" data-media="voice-mode">'.concat(mic, "</button>");
    }
    function input() {
      return '<div id="voice-input" class="voice-input hidden"><button class="voice-hold" data-media="voice-hold">按住说话</button><div class="desktop-voice-controls"><span id="voice-status">语音最长 60 秒</span><button class="primary" data-media="voice-start">开始录音</button><button class="secondary hidden" data-media="voice-cancel">取消</button><button class="primary hidden" data-media="voice-finish">发送语音</button></div></div><input id="video-input" class="file-input" type="file" accept="video/mp4,video/webm"><input id="video-capture-input" class="file-input" type="file" accept="video/*" capture="environment">';
    }
    function mount() {
      var _a, _b, _c;
      (_a = $2(".composer")) == null ? void 0 : _a.classList.toggle("voice-mode", mode);
      (_b = $2("#voice-input")) == null ? void 0 : _b.classList.toggle("hidden", !mode);
      (_c = $2("[data-media=voice-mode]")) == null ? void 0 : _c.classList.toggle("active", mode);
      for (const id of ["video-input", "video-capture-input"]) if ($2("#" + id)) $2("#" + id).onchange = (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (file) sendVideo(file);
      };
      renderRecording();
    }
    function renderRecording() {
      var _a, _b, _c, _d;
      const state = recording, ready = state == null ? void 0 : state.context, elapsed = ready ? state.frames / state.rate : 0, cancelled = hold == null ? void 0 : hold.cancel;
      if ($2("#voice-status")) $2("#voice-status").textContent = state ? ready ? "正在录音 ".concat(Math.floor(elapsed), " / 60 秒") : "正在请求麦克风权限…" : "语音最长 60 秒";
      const holdButton = $2("[data-media=voice-hold]");
      if (holdButton) {
        holdButton.textContent = state ? cancelled ? "松开取消" : "松开发送，上滑取消" : "按住说话";
        holdButton.classList.toggle("recording", !!state);
      }
      (_a = $2("[data-media=voice-start]")) == null ? void 0 : _a.classList.toggle("hidden", !!state);
      (_b = $2("[data-media=voice-cancel]")) == null ? void 0 : _b.classList.toggle("hidden", !state);
      (_c = $2("[data-media=voice-finish]")) == null ? void 0 : _c.classList.toggle("hidden", !state);
      if ($2("[data-media=voice-finish]")) $2("[data-media=voice-finish]").disabled = !ready;
      if (!state) {
        (_d = $2("#voice-record-overlay")) == null ? void 0 : _d.remove();
        return;
      }
      if (!$2("#voice-record-overlay")) document.body.insertAdjacentHTML("beforeend", '<aside id="voice-record-overlay" class="voice-record-overlay" aria-live="polite"><div class="record-wave">'.concat(Array.from({ length: 7 }, () => "<i></i>").join(""), "</div><b></b><p></p></aside>"));
      const overlay = $2("#voice-record-overlay");
      overlay.classList.toggle("cancelling", !!cancelled);
      $2("b", overlay).textContent = ready ? "".concat(Math.floor(elapsed), "″") : "正在请求麦克风权限";
      $2("p", overlay).textContent = cancelled ? "松开手指，取消发送" : state.held ? "松开发送，上滑取消" : "录音完成后点击发送";
      overlay.style.setProperty("--voice-level", String(0.35 + Math.min(1, (state.level || 0) * 8)));
    }
    async function begin(held) {
      var _a, _b;
      if (recording || !S2.active || !S2.user) return;
      if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getUserMedia) || !window.AudioContext && !window.webkitAudioContext) {
        toast2("当前设备不支持录音，请更新 WebView 或检查麦克风");
        return;
      }
      audio.pause();
      const state = recording = { cid: S2.active, userId: S2.user.id, held, chunks: [], frames: 0, rate: 0 };
      renderRecording();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (recording !== state || document.hidden) {
          stream.getTracks().forEach((t) => t.stop());
          if (!document.hidden && S2.active === state.cid && ((_b = S2.user) == null ? void 0 : _b.id) === state.userId) {
            mode = true;
            mount();
            toast2("麦克风已允许，请重新开始录音");
          }
          return;
        }
        state.stream = stream;
        const Context = window.AudioContext || window.webkitAudioContext;
        const context = new Context();
        state.context = context;
        state.rate = context.sampleRate;
        await context.resume();
        if (recording !== state) {
          release(state);
          return;
        }
        state.source = context.createMediaStreamSource(stream);
        state.processor = context.createScriptProcessor(4096, 1, 1);
        state.silence = context.createGain();
        state.silence.gain.value = 0;
        state.processor.onaudioprocess = (e) => {
          if (recording !== state) return;
          const input2 = e.inputBuffer.getChannelData(0), remaining = Math.max(0, Math.floor(state.rate * 60) - state.frames), data = input2.slice(0, Math.min(input2.length, remaining));
          state.chunks.push(data);
          state.frames += data.length;
          let level = 0;
          for (let i = 0; i < data.length; i += 16) level += data[i] * data[i];
          state.level = Math.sqrt(level / Math.max(1, data.length / 16));
          if (state.frames >= state.rate * 60 && !state.limit) {
            state.limit = true;
            setTimeout(() => finish(false), 0);
          }
        };
        state.source.connect(state.processor);
        state.processor.connect(state.silence);
        state.silence.connect(context.destination);
        state.timer = setInterval(renderRecording, 150);
        renderRecording();
        for (const track of stream.getTracks()) track.onended = () => {
          if (recording === state) finish(true);
        };
      } catch (error) {
        if (recording === state) {
          recording = null;
          release(state);
          renderRecording();
          toast2(error.name === "NotAllowedError" ? "未获得麦克风权限，请允许后重新录制" : "无法录音：" + error.message);
        }
      }
    }
    function release(state) {
      var _a, _b;
      clearInterval(state.timer);
      if (state.processor) state.processor.onaudioprocess = null;
      for (const node of [state.source, state.processor, state.silence]) try {
        node == null ? void 0 : node.disconnect();
      } catch (e) {
      }
      ;
      (_a = state.stream) == null ? void 0 : _a.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      (_b = state.context) == null ? void 0 : _b.close().catch(() => {
      });
    }
    function wav(state) {
      const all = new Float32Array(state.frames);
      let offset = 0;
      for (const chunk of state.chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      const rate = 24e3, length = Math.min(rate * 60, Math.floor(all.length * rate / state.rate)), buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer), str = (at, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
      };
      str(0, "RIFF");
      view.setUint32(4, 36 + length * 2, true);
      str(8, "WAVE");
      str(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      str(36, "data");
      view.setUint32(40, length * 2, true);
      const ratio = state.rate / rate;
      for (let i = 0; i < length; i++) {
        const at = i * ratio, start = Math.floor(at), end = Math.min(all.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sample = 0;
        for (let j = start; j < end; j++) sample += all[j];
        sample = Math.max(-1, Math.min(1, sample / (end - start)));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
      }
      return new File([buffer], "语音-" + Date.now() + ".wav", { type: "audio/wav" });
    }
    function finish(cancel) {
      const state = recording;
      if (!state) return;
      recording = null;
      hold = null;
      release(state);
      renderRecording();
      if (cancel) return;
      if (!state.rate || state.frames / state.rate < 0.7) {
        toast2("说话时间太短，请重新录制");
        return;
      }
      if (!S2.user || S2.user.id !== state.userId) return;
      sendMedia(wav(state), "voice", {}, state.cid).catch(showRetry);
    }
    const accountScope = () => {
      var _a;
      return JSON.stringify([S2.config.server, S2.config.fingerprint, (_a = S2.user) == null ? void 0 : _a.id, S2.token]);
    };
    async function sendMedia(file, kind, metadata2 = {}, cid = S2.active) {
      const owner2 = accountScope(), retry = () => {
        if (accountScope() !== owner2) throw Error("登录账号已变化");
        return enqueue(cid, { kind, text: "" }, file, metadata2);
      };
      try {
        return await retry();
      } catch (error) {
        error.retry = retry;
        throw error;
      }
    }
    function showRetry(error) {
      if (!error.retry) {
        toast2(error.message);
        return;
      }
      modal2("未能保存待发送内容", '<p class="hint">'.concat(esc2(error.message), "。录音或视频暂时保留在当前窗口，关闭窗口前请重试保存。</p>"), '<button class="secondary" data-action="close-modal">关闭</button><button class="primary" id="media-retry">重试保存</button>');
      $2("#media-retry").onclick = async (e) => {
        e.target.disabled = true;
        try {
          await error.retry();
          closeModal2();
        } catch (next) {
          next.retry = error.retry;
          showRetry(next);
        }
      };
    }
    function videoMetadata(file) {
      return new Promise((resolve, reject) => {
        const v = document.createElement("video"), url = URL.createObjectURL(file);
        v.preload = "metadata";
        v.muted = true;
        let timer, done = false;
        const finish2 = (error, result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          v.onloadedmetadata = v.ondurationchange = v.ontimeupdate = v.onerror = null;
          v.removeAttribute("src");
          v.load();
          URL.revokeObjectURL(url);
          error ? reject(error) : resolve(result);
        };
        const check = () => {
          const duration = v.duration;
          if (Number.isFinite(duration) && duration > 0 && v.videoWidth && v.videoHeight) finish2(null, { durationMs: Math.round(duration * 1e3), width: v.videoWidth, height: v.videoHeight });
        };
        v.onloadedmetadata = () => {
          check();
          if (!done && !Number.isFinite(v.duration)) try {
            v.currentTime = 1e10;
          } catch (e) {
          }
        };
        v.ondurationchange = v.ontimeupdate = check;
        v.onerror = () => finish2(Error("当前设备无法播放这段视频"));
        timer = setTimeout(() => finish2(Error("无法读取视频信息")), 15e3);
        v.src = url;
      });
    }
    async function sendVideo(file) {
      var _a;
      const cid = S2.active, owner2 = accountScope();
      if (!cid) return;
      if (((_a = S2.policy) == null ? void 0 : _a.chatMaxAttachmentBytes) > 0 && file.size > S2.policy.chatMaxAttachmentBytes) {
        toast2("文件超过服务器配置的大小限制");
        return;
      }
      const fallback = (error) => {
        if (accountScope() !== owner2) return;
        modal2("无法直接发送视频", '<p class="hint">'.concat(esc2(error.message), "，可以作为普通文件发送给对方。</p>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="video-send-file">作为文件发送</button>');
        $2("#video-send-file").onclick = () => {
          closeModal2();
          if (S2.active === cid && accountScope() === owner2) upload2(file, true);
          else toast2("聊天已切换，请重新选择文件");
        };
      };
      let metadata2;
      try {
        metadata2 = await videoMetadata(file);
      } catch (error) {
        fallback(error);
        return;
      }
      if (accountScope() !== owner2) return;
      try {
        await sendMedia(file, "video", metadata2, cid);
      } catch (error) {
        if (error.status === 400) fallback(error);
        else showRetry(error);
      }
    }
    function sync() {
      var _a;
      document.querySelectorAll("[data-play-voice]").forEach((button) => {
        var _a2;
        const active = (playing == null ? void 0 : playing.id) === button.dataset.playVoice && !audio.paused;
        button.classList.toggle("is-playing", active);
        button.setAttribute("aria-label", (active ? "暂停语音" : "播放语音") + " " + seconds(button.dataset.duration) + " 秒");
        if (played().has(button.dataset.playVoice)) (_a2 = $2(".voice-unplayed", button)) == null ? void 0 : _a2.remove();
      });
      if (recording && ((_a = $2(".composer")) == null ? void 0 : _a.classList.contains("selection-hidden"))) finish(true);
    }
    function stopVideo() {
      if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute("src");
        videoPlayer.load();
        videoPlayer = null;
      }
    }
    function reset() {
      finish(true);
      audio.pause();
      playing = null;
      stopVideo();
      mode = false;
      mount();
    }
    function invalidate(id) {
      if ((playing == null ? void 0 : playing.messageID) === id) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        playing = null;
      }
      if ((videoPlayer == null ? void 0 : videoPlayer.dataset.messageId) === id) {
        stopVideo();
        if ($2(".video-viewer")) closeModal2();
      }
    }
    async function playVoice(button) {
      finish(true);
      stopVideo();
      const id = button.dataset.playVoice;
      if ((playing == null ? void 0 : playing.id) === id && !audio.paused) {
        audio.pause();
        return;
      }
      if ((playing == null ? void 0 : playing.id) !== id) {
        audio.pause();
        audio.src = fileURL2(id);
        playing = { id, messageID: button.dataset.mediaMessage };
      }
      if (audio.ended) audio.currentTime = 0;
      try {
        await audio.play();
        if (S2.user && (playing == null ? void 0 : playing.id) === id) markPlayed(id);
        sync();
      } catch (error) {
        if (S2.user) toast2("无法播放语音，请检查网络或下载后播放");
        sync();
      }
    }
    function playVideo(button) {
      finish(true);
      audio.pause();
      stopVideo();
      modal2(button.dataset.mediaName || "视频", '<div class="video-viewer"><video id="message-video-player" controls playsinline preload="metadata" src="'.concat(fileURL2(button.dataset.playVideo), '"></video><p class="hint">').concat(esc2(button.dataset.mediaName || "视频"), "</p></div>"), (button.dataset.mediaRoot ? '<button class="secondary" data-fw="record-return">返回聊天记录</button>' : "") + '<button class="secondary" data-download="' + button.dataset.playVideo + '" data-filename="' + esc2(button.dataset.mediaName || "视频") + '">保存视频</button>', true);
      videoPlayer = $2("#message-video-player");
      videoPlayer.dataset.messageId = button.dataset.mediaMessage;
      videoPlayer.onerror = () => toast2("当前设备无法播放此视频，可保存文件后播放");
      videoPlayer.play().catch(() => {
      });
    }
    for (const type of ["play", "pause", "ended"]) audio.addEventListener(type, sync);
    new MutationObserver(() => {
      if (videoPlayer && !document.contains(videoPlayer)) stopVideo();
    }).observe($2("#overlays"), { childList: true, subtree: true });
    document.addEventListener("click", (e) => {
      var _a;
      const button = e.target.closest("[data-media],[data-play-voice],[data-play-video]");
      if (!button) return;
      if (button.dataset.playVoice) {
        playVoice(button);
        return;
      }
      if (button.dataset.playVideo) {
        playVideo(button);
        return;
      }
      switch (button.dataset.media) {
        case "voice-mode":
          finish(true);
          mode = !mode;
          if (mode) (_a = $2("#composer")) == null ? void 0 : _a.blur();
          mount();
          break;
        case "voice-start":
          begin(false);
          break;
        case "voice-cancel":
          finish(true);
          break;
        case "voice-finish":
          finish(false);
          break;
        case "video":
          if (window.WeLinkAndroid) {
            modal2("发送视频", '<button class="remote-choice" id="video-from-gallery">' + icon2("folder") + '从相册选择</button><button class="remote-choice" id="video-from-camera">' + icon2("video") + '拍摄视频</button><p class="hint">支持 MP4、WebM。文件大小遵循服务器配置。</p>');
            $2("#video-from-gallery").onclick = () => {
              closeModal2();
              $2("#video-input").click();
            };
            $2("#video-from-camera").onclick = () => {
              closeModal2();
              $2("#video-capture-input").click();
            };
          } else $2("#video-input").click();
          break;
      }
    });
    document.addEventListener("pointerdown", (e) => {
      const button = e.target.closest("[data-media=voice-hold]");
      if (!button || e.button !== 0) return;
      e.preventDefault();
      hold = { pointer: e.pointerId, y: e.clientY, cancel: false };
      button.setPointerCapture(e.pointerId);
      begin(true);
    });
    document.addEventListener("pointermove", (e) => {
      if (hold && hold.pointer === e.pointerId) {
        hold.cancel = e.clientY < hold.y - 60;
        renderRecording();
      }
    });
    document.addEventListener("pointerup", (e) => {
      if (hold && hold.pointer === e.pointerId) {
        const cancel = hold.cancel;
        hold = null;
        finish(cancel);
      }
    });
    document.addEventListener("pointercancel", () => {
      if (hold) {
        hold = null;
        finish(true);
      }
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-nav],[data-conversation],[data-action=back],[data-action=logout]")) reset();
    }, true);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) reset();
    });
    window.addEventListener("blur", () => finish(true));
    window.WeLinkMediaBackground = reset;
    window.WeLinkMediaBeforeModal = () => finish(true);
    return { bubble, tools, input, mount, reset, invalidate, sync, sendVideo };
  }

  // internal/ui/src/forwarding.js
  function createForwarding({ S: S2, api: api2, action: action2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, av: av2, preview: preview2, fullTime: fullTime2, bytes: bytes2, fileURL: fileURL2, randomID: randomID2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, mediaBubble }) {
    const $2 = (s, r = document) => r.querySelector(s);
    let selection = null, chooser = null, viewer = null;
    function selected(message) {
      return (selection == null ? void 0 : selection.cid) === S2.active && selection.ids.has(message.id);
    }
    function checkbox(message) {
      return (selection == null ? void 0 : selection.cid) === S2.active ? '<button class="message-check" role="checkbox" aria-checked="'.concat(selected(message), '" aria-label="选择消息">').concat(selected(message) ? icon2("check") : "", "</button>") : "";
    }
    function reset(render = true) {
      selection = null;
      if (render) renderMessages2(true);
    }
    function sync() {
      var _a;
      if (selection && (selection.cid !== S2.active || S2.tab !== "messages" || !S2.user)) selection = null;
      const area = $2("#messages"), composer = $2(".composer");
      if (!area) return;
      area.classList.toggle("selecting-messages", !!selection);
      if (composer) composer.classList.toggle("selection-hidden", !!selection);
      (_a = $2("#message-selection-toolbar")) == null ? void 0 : _a.remove();
      if (!selection) return;
      const selectedMessages = S2.messages.filter((m) => selection.ids.has(m.id));
      selection.ids = new Set(selectedMessages.map((m) => m.id));
      const count = selection.ids.size, unavailable = selectedMessages.some((m) => m.recalled);
      area.insertAdjacentHTML("afterend", '<section class="message-selection-toolbar" id="message-selection-toolbar"><div><b>已选择 '.concat(count, ' 条消息</b><button data-fw="cancel-select">取消</button></div><nav><button data-fw="selected-forward" ').concat(!count || unavailable ? "disabled" : "", ' title="').concat(unavailable ? "已撤回消息不能转发" : "转发所选消息", '">').concat(icon2("send"), '<span>转发</span></button><button data-fw="selected-delete" ').concat(count ? "" : "disabled", ">").concat(icon2("trash"), "<span>删除</span></button></nav></section>"));
    }
    function start(id) {
      selection = { cid: S2.active, ids: /* @__PURE__ */ new Set([id]) };
      renderMessages2(true);
    }
    function toggle(id) {
      if (selection.ids.has(id)) selection.ids.delete(id);
      else if (selection.ids.size < 100) selection.ids.add(id);
      else {
        toast2("一次最多选择 100 条消息");
        return;
      }
      renderMessages2(true);
    }
    function removed(id) {
      if (selection) {
        selection.ids.delete(id);
        sync();
      }
      invalidate(id);
    }
    function invalidate(id) {
      if ((viewer == null ? void 0 : viewer.id) === id && ($2(".forward-record-dialog") || $2(".forward-record-image"))) {
        viewer = null;
        closeModal2();
        toast2("这条聊天记录已删除或撤回");
      }
    }
    function deleteSelected() {
      const state = selection;
      if (!(state == null ? void 0 : state.ids.size)) return;
      const ids = [...state.ids];
      modal2("删除所选消息", '<p class="hint">删除这 '.concat(ids.length, " 条消息？它们将从你所有设备的聊天记录中移除，对方的记录和已保存的收藏会保留。</p>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="selection-delete-confirm">删除</button>');
      $2("#selection-delete-confirm").onclick = async (e) => {
        e.target.disabled = true;
        try {
          await action2("/api/conversations/".concat(state.cid, "/messages/delete"), { messageIds: ids });
          if (S2.active === state.cid) S2.messages = S2.messages.filter((m) => !ids.includes(m.id));
          reset();
          closeModal2();
          queueRefresh2();
          toast2("已删除所选消息");
        } catch (error) {
          $2("#modal-error").textContent = error.message;
          e.target.disabled = false;
        }
      };
    }
    function targets(tab) {
      const recent = S2.conversations.filter((c) => c.canSend !== false).map((c) => {
        var _a;
        return { key: c.id, cid: c.id, name: c.name, kind: c.kind, avatar: ((_a = c.peer) == null ? void 0 : _a.avatar) || "group" };
      });
      if (tab === "groups") return recent.filter((c) => c.kind === "group");
      if (tab === "friends") return S2.friends.map((u) => {
        const existing = S2.conversations.find((c) => {
          var _a;
          return c.kind === "direct" && ((_a = c.peer) == null ? void 0 : _a.id) === u.id;
        });
        return { key: (existing == null ? void 0 : existing.id) || "user:" + u.id, cid: existing == null ? void 0 : existing.id, userId: u.id, name: u.remark || u.name, number: u.number, avatar: u.avatar };
      });
      return recent;
    }
    function renderTargets() {
      const state = chooser;
      if (!state || !$2("#forward-recipients")) return;
      const query = $2("#forward-search").value.toLowerCase();
      const items = targets(state.tab).filter((c) => (c.name + (c.number || "")).toLowerCase().includes(query));
      $2("#forward-recipients").innerHTML = items.map((c) => '<label class="forward-recipient">'.concat(av2(c), "<span>").concat(esc2(c.name)).concat(c.number ? "<small>".concat(esc2(c.number), "</small>") : "", '</span><input type="checkbox" value="').concat(esc2(c.key), '" ').concat(state.targets.has(c.key) ? "checked" : "", ' aria-label="选择 ').concat(esc2(c.name), '"></label>')).join("") || '<p class="empty-list">没有匹配的会话</p>';
      $2("#forward-recipients").onchange = (e) => {
        const target = items.find((c) => c.key === e.target.value);
        if (!target) return;
        if (e.target.checked) {
          if (state.targets.size >= 9) {
            e.target.checked = false;
            toast2("最多选择 9 个会话");
            return;
          }
          state.targets.set(target.key, target);
        } else state.targets.delete(target.key);
        renderChosen();
      };
      document.querySelectorAll("[data-forward-tab]").forEach((b) => b.classList.toggle("active", b.dataset.forwardTab === state.tab));
    }
    function renderChosen() {
      const state = chooser;
      $2("#forward-selected-count").textContent = "已选择 ".concat(state.targets.size, " 个会话");
      $2("#forward-selected").innerHTML = [...state.targets.values()].map((c) => '<button class="forward-chip" data-forward-remove="'.concat(esc2(c.key), '">').concat(esc2(c.name), "<span>×</span></button>")).join("") || '<p class="hint">选择好友或群聊</p>';
      $2("#forward-submit").disabled = !state.targets.size;
    }
    function open(ids) {
      const messages = S2.messages.filter((m) => ids.includes(m.id));
      if (!messages.length || messages.some((m) => m.recalled) || messages.length !== ids.length) {
        toast2("所选消息已删除或撤回");
        return;
      }
      const state = chooser = { cid: S2.active, ids, tab: "recent", targets: /* @__PURE__ */ new Map(), mode: ids.length > 1 ? "merge" : "each", messages, signature: "", clientId: "" };
      modal2("发送给", '<div class="forward-chooser"><section class="forward-people"><input id="forward-search" aria-label="搜索接收人" placeholder="搜索好友或群聊"><nav class="forward-tabs"><button data-forward-tab="recent" class="active">最近</button><button data-forward-tab="friends">好友</button><button data-forward-tab="groups">群聊</button></nav><div id="forward-recipients"></div></section><section class="forward-confirm"><b id="forward-selected-count"></b><div id="forward-selected"></div>'.concat(ids.length > 1 ? '<div class="forward-mode"><label><input type="radio" name="forward-mode" value="merge" checked>合并转发</label><label><input type="radio" name="forward-mode" value="each">逐条转发</label></div>' : "", '<div class="forward-send-preview"><b>').concat(ids.length > 1 ? "聊天记录" : esc2(preview2(messages[0]).slice(0, 60)), "</b>").concat(ids.length > 1 ? messages.slice(0, 3).map((m) => "<p>".concat(esc2(m.name + "：" + preview2(m)), "</p>")).join("") : "", "<small>").concat(ids.length, ' 条消息</small></div><textarea id="forward-note" placeholder="给对方留言（可选）" aria-label="转发留言" maxlength="600"></textarea></section></div>'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="forward-submit" disabled>发送</button>', true);
      $2(".modal").classList.add("forward-dialog");
      renderTargets();
      renderChosen();
      $2("#forward-search").oninput = renderTargets;
      $2("#forward-selected").onclick = (e) => {
        const button = e.target.closest("[data-forward-remove]");
        if (button) {
          state.targets.delete(button.dataset.forwardRemove);
          renderTargets();
          renderChosen();
        }
      };
      $2(".forward-tabs").onclick = (e) => {
        const b = e.target.closest("[data-forward-tab]");
        if (b) {
          state.tab = b.dataset.forwardTab;
          renderTargets();
        }
      };
      document.querySelectorAll("[name=forward-mode]").forEach((input) => input.onchange = () => {
        state.mode = input.value;
      });
      $2("#forward-submit").onclick = async () => {
        const button = $2("#forward-submit");
        button.disabled = true;
        const chosen = [...state.targets.values()].map((target) => __spreadValues({}, target)), mode = state.mode, note = $2("#forward-note").value;
        try {
          const destinations = [];
          for (const target of chosen) {
            if (!target.cid) {
              const created = await action2("/api/conversations", { kind: "direct", members: [target.userId] });
              target.cid = created.id;
            }
            destinations.push(target.cid);
          }
          const body = { conversationId: state.cid, messageIds: state.ids, targets: destinations, mode, note };
          const signature = JSON.stringify(body);
          if (signature !== state.signature) {
            state.signature = signature;
            state.clientId = randomID2();
          }
          await action2("/api/messages/forward", __spreadProps(__spreadValues({}, body), { clientId: state.clientId }));
          closeModal2();
          reset();
          queueRefresh2();
          toast2("已转发到 ".concat(destinations.length, " 个会话"));
        } catch (error) {
          if ($2("#modal-error")) $2("#modal-error").textContent = error.message;
          button.disabled = false;
        }
      };
    }
    function card(m) {
      let card2;
      try {
        card2 = JSON.parse(m.text);
      } catch (e) {
        return esc2("[聊天记录]");
      }
      ;
      return '<button class="forward-card" data-forward-view="'.concat(m.id, '"><b>').concat(esc2(card2.title), "</b>").concat((card2.preview || []).slice(0, 3).map((line) => "<p>".concat(esc2(line), "</p>")).join(""), "<small>聊天记录 · ").concat(Number(card2.count) || 0, " 条</small></button>");
    }
    function previewRecord(record) {
      return "<b>".concat(esc2(record.title), "</b>").concat(record.items.slice(0, 3).map((item) => "<p>".concat(esc2(item.name + "：" + preview2(item)), "</p>")).join(""), "<small>聊天记录 · ").concat(record.items.length, " 条</small>");
    }
    function showDocument() {
      const record = viewer.stack[viewer.stack.length - 1];
      modal2(record.title, '<div class="forward-record">'.concat(record.items.map((item, index) => {
        let content = esc2(item.text);
        if (item.kind === "image") content = '<img loading="lazy" src="'.concat(fileURL2(item.attachmentId), '" alt="').concat(esc2(item.fileName || "图片"), '" data-forward-image="').concat(item.attachmentId, '">');
        else if (item.kind === "file") content = '<button class="file-card" data-download="'.concat(item.attachmentId, '" data-filename="').concat(esc2(item.fileName), '">').concat(icon2("file"), "<span><b>").concat(esc2(item.fileName), "</b><small>").concat(bytes2(item.fileSize), " · 点击下载</small></span></button>");
        else if (item.kind === "voice" || item.kind === "video") content = mediaBubble(item, viewer.id);
        else if (item.record) content = '<button class="forward-card" data-forward-nested="'.concat(index, '">').concat(previewRecord(item.record), "</button>");
        else if (item.kind === "call") content = esc2(preview2(item));
        else if (item.kind === "meeting") content = esc2("[会议]");
        return '<article class="forward-record-item">'.concat(av2(item), "<div><header><b>").concat(esc2(item.name), "</b><time>").concat(fullTime2(item.created), '</time></header><div class="forward-record-content">').concat(content, "</div>").concat(item.quote ? '<p class="forward-record-quote">'.concat(esc2(item.quote.name + "：" + item.quote.text), "</p>") : "", "</div></article>");
      }).join(""), "</div>"), viewer.stack.length > 1 ? '<button class="secondary" data-fw="record-back">返回上一层</button>' : "", true);
      $2(".modal").classList.add("forward-record-dialog");
    }
    async function view(id) {
      try {
        const document2 = await api2("/api/messages/".concat(id, "/forward"));
        viewer = { id, stack: [document2] };
        showDocument();
      } catch (e) {
        toast2(e.message);
      }
    }
    document.addEventListener("click", (e) => {
      var _a;
      if (!selection) return;
      const message = e.target.closest("[data-message]");
      if (message && ((_a = $2("#messages")) == null ? void 0 : _a.contains(message))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle(message.dataset.message);
      }
    }, true);
    document.addEventListener("contextmenu", (e) => {
      if (selection && e.target.closest("[data-message]")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && selection && !$2(".modal")) reset();
    });
    document.addEventListener("click", (e) => {
      var _a, _b;
      const button = e.target.closest("[data-fw],[data-forward-view],[data-forward-nested],[data-forward-image]");
      if (!button) return;
      (_a = $2(".context-menu")) == null ? void 0 : _a.remove();
      if (button.dataset.forwardView) {
        view(button.dataset.forwardView);
        return;
      }
      if (button.dataset.forwardNested !== void 0) {
        const record = (_b = viewer == null ? void 0 : viewer.stack[viewer.stack.length - 1].items[Number(button.dataset.forwardNested)]) == null ? void 0 : _b.record;
        if (record) {
          viewer.stack.push(record);
          showDocument();
        }
        ;
        return;
      }
      if (button.dataset.forwardImage) {
        modal2("图片", '<img class="forward-record-image" src="'.concat(fileURL2(button.dataset.forwardImage), '" alt="图片预览">'), '<button class="secondary" data-fw="image-back">返回聊天记录</button>', true);
        return;
      }
      switch (button.dataset.fw) {
        case "single":
          open([button.dataset.mid]);
          break;
        case "select":
          start(button.dataset.mid);
          break;
        case "cancel-select":
          reset();
          break;
        case "selected-forward":
          if (selection) open([...selection.ids]);
          break;
        case "selected-delete":
          deleteSelected();
          break;
        case "record-back":
          viewer == null ? void 0 : viewer.stack.pop();
          showDocument();
          break;
        case "image-back":
        case "record-return":
          showDocument();
          break;
      }
    });
    return { checkbox, selected, sync, reset, removed, invalidate, open, card };
  }

  // internal/ui/src/history.js
  function createHistory({ S: S2, api: api2, modal: modal2, toast: toast2, esc: esc2, preview: preview2, fullTime: fullTime2, jump }) {
    let current = null;
    const $2 = (s) => document.querySelector(s);
    function render() {
      const state = current, list = $2("#history-results");
      if (!list || !state) return;
      list.innerHTML = state.items.map((m) => '<button class="history-item" data-history-id="'.concat(m.id, '"><small>').concat(esc2(m.name), " · ").concat(fullTime2(m.created), "</small><p>").concat(esc2(preview2(m)), "</p><span>查看上下文</span></button>")).join("") || '<div class="empty-list">未找到相关消息</div>';
      if (S2.cacheView) list.insertAdjacentHTML("afterbegin", '<p class="hint">当前仅搜索此设备已缓存的消息，联网后可搜索完整记录。</p>');
      if (state.more) list.insertAdjacentHTML("beforeend", '<button class="history-more secondary">加载更早记录</button>');
      list.querySelectorAll("[data-history-id]").forEach((button) => button.onclick = () => jump(state.cid, button.dataset.historyId).catch((e) => toast2(e.message)));
      const more = list.querySelector(".history-more");
      if (more) more.onclick = () => load(true);
    }
    async function load(older = false) {
      var _a;
      const state = current;
      if (!state || !$2("#history-search")) return;
      const revision = ++state.revision;
      const params = new URLSearchParams({ q: $2("#history-search").value, kind: $2("#history-kind").value, sender: $2("#history-sender").value });
      for (const field of ["from", "to"]) {
        const value = $2("#history-" + field).value;
        if (value) {
          const day = /* @__PURE__ */ new Date(value + "T00:00:00");
          if (field === "to") day.setDate(day.getDate() + 1);
          params.set(field, String(day.getTime()));
        }
      }
      if ((_a = $2("#history-mentions")) == null ? void 0 : _a.checked) params.set("mentions", "me");
      if (older && state.items.length) params.set("before", String(state.items[state.items.length - 1].seq));
      if (!older) $2("#history-results").innerHTML = '<p class="hint">正在查找…</p>';
      else $2(".history-more").disabled = true;
      try {
        const items = await api2("/api/conversations/".concat(state.cid, "/messages?").concat(params));
        if (current !== state || state.revision !== revision || !$2("#history-results")) return;
        state.items = older ? [...state.items, ...items.reverse()] : items.reverse();
        state.more = items.length === 60;
        render();
      } catch (e) {
        if (current === state && state.revision === revision) {
          toast2(e.message);
          render();
        }
      }
    }
    async function open() {
      var _a;
      const state = current = { cid: S2.active, items: [], more: false, revision: 0 };
      modal2("聊天记录", '<div class="history-search-box"><input id="history-search" maxlength="200" placeholder="搜索消息内容或文件名" aria-label="搜索聊天记录"></div><div class="history-filters"><label>消息类型<select id="history-kind"><option value="">全部消息</option value="text">文字</option><option value="image">图片</option><option value="voice">语音</option><option value="video">视频</option><option value="file">文件</option><option value="meeting">会议</option><option value="call">通话</option><option value="forward">聊天记录</option></select></label><label>发送人<select id="history-sender"><option value="">所有人</option></select></label><label>开始日期<input type="date" id="history-from"></label><label>结束日期<input type="date" id="history-to"></label></div>'.concat(((_a = S2.conversations.find((c) => c.id === state.cid)) == null ? void 0 : _a.kind) === "group" ? '<label class="history-mention-filter"><input type="checkbox" id="history-mentions">只看 @我的消息</label>' : "", '<div id="history-results" class="history-results" aria-live="polite"></div>'), "", true);
      let timer;
      $2("#history-search").oninput = () => {
        clearTimeout(timer);
        ++state.revision;
        state.items = [];
        state.more = false;
        $2("#history-results").innerHTML = '<p class="hint">正在查找…</p>';
        timer = setTimeout(() => load(), 250);
      };
      for (const id of ["kind", "sender", "from", "to"]) $2("#history-" + id).onchange = () => {
        clearTimeout(timer);
        load();
      };
      if ($2("#history-mentions")) $2("#history-mentions").onchange = () => load();
      load();
      try {
        const detail = await api2("/api/conversations/" + state.cid);
        if (current === state && $2("#history-sender")) $2("#history-sender").innerHTML = '<option value="">所有人</option>' + detail.members.map((u) => '<option value="'.concat(u.id, '">').concat(esc2(u.name), "</option>")).join("");
      } catch (e) {
        toast2(e.message);
      }
    }
    function changed(id, recalled = false) {
      var _a;
      if (!current || !$2("#history-results")) return;
      current.revision++;
      current.items = current.items.filter((m) => m.id !== id);
      if (recalled) {
        for (const item of current.items) if (((_a = item.reply) == null ? void 0 : _a.id) === id) item.reply = __spreadProps(__spreadValues({}, item.reply), { text: "", fileName: "", recalled: true });
      }
      render();
    }
    return { open, changed };
  }

  // internal/ui/src/security.js
  function createSecurity({ api: api2, action: action2, S: S2, modal: modal2, toast: toast2, esc: esc2, icon: icon2, logout: logout2 }) {
    const el = (id) => document.getElementById(id);
    const when = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "暂无活动记录";
    function open() {
      modal2("账号与安全", '<div class="security-account">'.concat(icon2("shield"), "<div><b>").concat(esc2(S2.user.name), "</b>").concat(S2.user.email ? "<p>邮箱：".concat(esc2(S2.user.email), "</p>") : "", "<p>LinkMe 号：").concat(esc2(S2.user.number), '</p></div></div><button class="utility-row security-option" data-security="devices">').concat(icon2("monitor"), '<div class="body"><b>登录设备</b><p>查看设备，退出不再使用的登录</p></div>').concat(icon2("chevron"), '</button><button class="utility-row security-option" data-security="password">').concat(icon2("shield"), '<div class="body"><b>修改密码</b><p>修改后其他设备需要重新登录</p></div>').concat(icon2("chevron"), "</button>"));
    }
    async function devices() {
      if (!S2.user) return;
      modal2("登录设备", '<p class="hint">退出设备后，该设备的聊天、会议和远程协助会断开。</p><div id="device-list">正在读取…</div>', '<button class="secondary" data-security="back">返回</button><button class="primary" id="revoke-other-devices">退出其他设备</button>');
      el("revoke-other-devices").disabled = true;
      try {
        const items = await api2("/api/auth/sessions");
        if (!el("device-list")) return;
        el("device-list").innerHTML = items.map((d) => '<article class="device-row">'.concat(icon2(d.device.includes("Android") ? "phone" : "monitor"), '<div class="device-details"><b>').concat(esc2(d.device), " ").concat(d.current ? '<span class="device-current">本设备</span>' : "", "</b><p>登录：").concat(esc2(when(d.created)), "</p><p>最近使用：").concat(esc2(when(d.lastSeen)), "</p></div>").concat(d.current ? "" : '<button class="device-remove" data-device-id="'.concat(esc2(d.id), '">退出</button>'), "</article>")).join("");
        el("revoke-other-devices").disabled = !items.some((d) => !d.current);
        el("device-list").onclick = (e) => {
          const button = e.target.closest("[data-device-id]");
          if (button) confirm(items.find((d) => d.id === button.dataset.deviceId));
        };
        el("revoke-other-devices").onclick = () => confirm();
      } catch (e) {
        if (el("device-list")) el("device-list").textContent = e.message;
      }
    }
    function confirm(device) {
      modal2(device ? "退出登录设备" : "退出其他设备", '<p class="hint">'.concat(device ? "确认让 " + esc2(device.device) + " 退出登录？" : "确认退出其他所有登录设备？当前设备会保留登录。", "该操作会断开对应设备的聊天、会议和远程协助。</p>"), '<button class="secondary" data-security="devices">取消</button><button class="primary" id="device-confirm-revoke">确认退出</button>');
      el("device-confirm-revoke").onclick = async () => {
        const button = el("device-confirm-revoke");
        button.disabled = true;
        try {
          const result = device ? await api2("/api/auth/sessions/" + encodeURIComponent(device.id), { method: "DELETE" }) : await action2("/api/auth/sessions/revoke-others");
          if (result.current) {
            await logout2(false);
            return;
          }
          toast2("已退出所选设备");
          await devices();
        } catch (e) {
          if (el("modal-error")) el("modal-error").textContent = e.message;
          button.disabled = false;
        }
      };
    }
    function password() {
      modal2("修改密码", '<form id="password-form"><label for="security-old-password">原密码</label><input id="security-old-password" type="password" autocomplete="current-password" required maxlength="72"><label for="security-new-password">新密码</label><input id="security-new-password" type="password" autocomplete="new-password" required minlength="8" maxlength="72" placeholder="至少 8 位"><label for="security-repeat-password">确认新密码</label><input id="security-repeat-password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"><p class="hint">修改成功后保留本设备，其他设备会退出登录；尚未完成的扫码授权也将失效。</p></form>', '<button class="secondary" data-security="back">取消</button><button type="submit" form="password-form" class="primary" id="password-save">保存密码</button>');
      el("password-form").onsubmit = async (e) => {
        e.preventDefault();
        const button = el("password-save"), oldPassword = el("security-old-password").value, newPassword = el("security-new-password").value;
        if (newPassword !== el("security-repeat-password").value) {
          el("modal-error").textContent = "两次输入的新密码不一致";
          return;
        }
        button.disabled = true;
        el("modal-error").textContent = "";
        try {
          await action2("/api/auth/password", { oldPassword, newPassword });
          toast2("密码已修改，其他设备已退出");
          open();
        } catch (error) {
          if (el("modal-error")) el("modal-error").textContent = error.message;
          button.disabled = false;
        }
      };
    }
    document.addEventListener("click", (e) => {
      const node = e.target.closest("[data-security],[data-action=security]");
      if (!node || !S2.user) return;
      switch (node.dataset.security || "back") {
        case "devices":
          devices();
          break;
        case "password":
          password();
          break;
        default:
          open();
      }
    });
    return { open, devices, password };
  }

  // internal/ui/src/qr-login.js
  function createQRLogin({ action: action2, S: S2, modal: modal2, toast: toast2, esc: esc2, enter: enter2, renderAuth: renderAuth2, windows: windows2, logo: logo2, icon: icon2 }) {
    let active = null, phonePending = null;
    const el = (id) => document.getElementById(id);
    function stop() {
      if (!active) return;
      const previous = active;
      active = null;
      clearTimeout(previous.timer);
      if (previous.id) action2("/api/auth/qr/cancel", { id: previous.id, pollSecret: previous.pollSecret }).catch(() => {
      });
    }
    async function open() {
      stop();
      const current = { timer: null };
      active = current;
      el("app").innerHTML = '<main class="auth-shell">'.concat(windows2()).concat(authShowcase(), '<section class="auth-card qr-auth">').concat(logo2(), '<h2>扫码登录</h2><p class="subtitle">使用安卓 LinkMe「扫一扫」</p><div class="qr-image" id="qr-image"><span>正在生成二维码…</span></div><p class="qr-status" id="qr-status">请在手机上登录你的 LinkMe 账号</p><p class="qr-check" id="qr-check"></p><div class="auth-error" id="auth-error"></div><button class="primary" id="qr-refresh">刷新二维码</button><div class="auth-links"><button data-action="login">密码登录</button>').concat(S2.registrationEnabled ? '<button data-action="register">注册账号</button>' : "", '</div><p class="auth-consent">扫码后请在手机上确认<br>二维码 3 分钟内有效，仅可使用一次</p></section><small class="auth-footer">LinkMe ').concat(CLIENT_VERSION, "</small></main>");
      el("qr-refresh").onclick = open;
      try {
        const q = await action2("/api/auth/qr", { device: "LinkMe Windows 客户端" });
        if (active !== current) {
          action2("/api/auth/qr/cancel", q).catch(() => {
          });
          return;
        }
        Object.assign(current, q);
        el("qr-image").innerHTML = '<img alt="LinkMe 桌面登录二维码" src="'.concat(q.image, '">');
        el("qr-check").textContent = "核对码 " + q.checkCode;
        await poll(current);
      } catch (e) {
        if (active === current) el("auth-error").textContent = e.message;
      }
    }
    async function poll(current) {
      if (active !== current) return;
      try {
        const result = await action2("/api/auth/qr/poll", { id: current.id, pollSecret: current.pollSecret });
        if (active !== current) return;
        if (result.token) {
          active = null;
          S2.token = result.token;
          S2.user = result.user;
          localStorage.setItem("welink_token", S2.token);
          await enter2();
          return;
        }
        const ended = result.state === "expired" || result.state === "rejected";
        el("qr-status").textContent = result.state === "scanned" ? "扫码成功，请在手机上确认" : result.state === "expired" ? "二维码已过期，请刷新" : result.state === "rejected" ? "手机已取消登录，请刷新" : "请使用安卓 LinkMe 扫描二维码";
        el("qr-image").classList.toggle("qr-inactive", ended);
        if (!ended) current.timer = setTimeout(() => poll(current), 1200);
      } catch (e) {
        if (active === current) {
          el("auth-error").textContent = e.message;
          if (e.status === 404) {
            el("qr-status").textContent = "二维码已失效，请刷新";
            el("qr-image").classList.add("qr-inactive");
          } else current.timer = setTimeout(() => poll(current), 3e3);
        }
      }
    }
    async function scanned(payload) {
      if (!S2.user) {
        toast2("请先在手机上登录 LinkMe");
        return;
      }
      const match = /^welink:\/\/login\/([a-f0-9]{32})\?key=([a-f0-9]{64})$/.exec(String(payload));
      if (!match) {
        toast2("这不是 LinkMe 登录二维码");
        return;
      }
      const request = { id: match[1], key: match[2] };
      try {
        const result = await action2("/api/auth/qr/scan", request);
        phonePending = request;
        modal2("登录 Windows 版 LinkMe", '<div class="qr-confirm"><div class="qr-computer">'.concat(icon2("monitor"), "</div><h3>").concat(esc2(result.device), "</h3><p>将使用 ").concat(esc2(S2.user.name), " 登录</p><p>LinkMe 号：").concat(esc2(S2.user.number), '</p><div class="qr-check">核对码 ').concat(esc2(result.checkCode), '</div><p class="hint">请核对电脑上的数字，只确认你正在操作的电脑。</p></div>'), '<button class="secondary" id="qr-phone-cancel">取消登录</button><button class="primary" id="qr-phone-confirm">确认登录</button>');
        const resolve = async (accept) => {
          var _a;
          const button = el(accept ? "qr-phone-confirm" : "qr-phone-cancel");
          button.disabled = true;
          try {
            await action2("/api/auth/qr/confirm", __spreadProps(__spreadValues({}, request), { accept }));
            phonePending = null;
            (_a = document.querySelector(".modal [data-action=close-modal]")) == null ? void 0 : _a.click();
            toast2(accept ? "已授权电脑登录" : "已取消电脑登录");
          } catch (e) {
            toast2(e.message);
            button.disabled = false;
          }
        };
        el("qr-phone-confirm").onclick = () => resolve(true);
        el("qr-phone-cancel").onclick = () => resolve(false);
      } catch (e) {
        toast2(e.message);
      }
    }
    window.WeLinkQrScanned = scanned;
    document.addEventListener("click", (e) => {
      var _a, _b;
      const a = (_a = e.target.closest("[data-action]")) == null ? void 0 : _a.dataset.action;
      if (a === "qr-login") open();
      if (a === "scan-qr") {
        if (!S2.user) {
          toast2("请先登录");
          return;
        }
        if ((_b = window.WeLinkAndroid) == null ? void 0 : _b.scanQRCode) window.WeLinkAndroid.scanQRCode();
        else toast2("请在安卓 LinkMe 中使用扫一扫");
      }
      if (a === "close-modal" && phonePending) {
        const request = phonePending;
        phonePending = null;
        action2("/api/auth/qr/confirm", __spreadProps(__spreadValues({}, request), { accept: false })).catch(() => {
        });
      }
    });
    window.addEventListener("pagehide", () => {
      clearTimeout(active == null ? void 0 : active.timer);
    });
    return { open, stop, scanned };
  }

  // internal/ui/src/meeting-tuning.js
  function videoBudget(screen, peers, available = 0) {
    const count = Math.max(1, peers), floor = screen ? 5e5 : 3e5, emergency = screen ? 25e4 : 15e4, ceiling = screen ? 35e5 : 15e5, total = screen ? 8e6 : 4e6;
    let target = Math.max(floor, Math.min(ceiling, Math.round(total / count)));
    if (available > 0) target = Math.min(target, Math.max(emergency, available * 0.82));
    return Math.max(emergency, Math.round(target));
  }
  async function tuneMeetingPeer(peer, screen, peers) {
    var _a, _b;
    if (peer.tuning || peer.pc.signalingState === "closed") return;
    const bitrate = videoBudget(screen, peers, (_a = peer.route) == null ? void 0 : _a.available), key = screen + ":" + Math.round(bitrate / 1e5);
    if (peer.tuningKey === key) return;
    peer.tuning = true;
    let complete = true;
    try {
      for (const sender of peer.pc.getSenders()) {
        if (!sender.track || !sender.getParameters) continue;
        try {
          const p = sender.getParameters();
          if (!((_b = p.encodings) == null ? void 0 : _b.length)) {
            complete = false;
            continue;
          }
          for (const e of p.encodings) {
            if (sender.track.kind === "audio") {
              e.maxBitrate = 64e3;
              if ("priority" in e) e.priority = "high";
              if ("networkPriority" in e) e.networkPriority = "high";
            } else {
              e.maxBitrate = Math.round(bitrate / p.encodings.length);
              e.maxFramerate = screen ? 30 : 24;
            }
          }
          if (sender.track.kind === "video") p.degradationPreference = screen ? "maintain-resolution" : "maintain-framerate";
          await sender.setParameters(p);
        } catch (e) {
          complete = false;
        }
      }
    } finally {
      if (complete) peer.tuningKey = key;
      peer.tuning = false;
    }
  }

  // internal/ui/src/rtc-path.js
  function directFirstICE(pc, policy, { alive, changed, negotiate }) {
    const servers = policy.iceServers || [], hasRelay = servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/.test(u)));
    let relay = false, closed = false, deadline, recovery, statsTimer, restarts = 0, path = "正在直连", rtt = -1, available = 0;
    const connected = () => ["connected", "completed"].includes(pc.iceConnectionState) || pc.connectionState === "connected";
    const valid = () => !closed && alive() && pc.connectionState !== "closed";
    const setPath = (value) => {
      if (path !== value) {
        path = value;
        changed();
      }
    };
    async function stats() {
      if (!valid() || !connected()) return;
      try {
        const report = await pc.getStats();
        if (!valid()) return;
        let pair;
        for (const value of report.values()) if (value.type === "transport" && value.selectedCandidatePairId) pair = report.get(value.selectedCandidatePairId);
        if (!pair) {
          for (const value of report.values()) if (value.type === "candidate-pair" && value.state === "succeeded" && (value.nominated || value.selected)) {
            pair = value;
            break;
          }
        }
        if (pair) {
          rtt = Number.isFinite(pair.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1e3) : -1;
          available = Number(pair.availableOutgoingBitrate) || 0;
          changed();
          const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
          setPath((local == null ? void 0 : local.candidateType) === "relay" || (remote == null ? void 0 : remote.candidateType) === "relay" ? "中转连接" : "P2P 直连");
        }
      } catch (e) {
      }
    }
    function fallback() {
      if (!valid() || connected()) return;
      if (!hasRelay) {
        setPath("直连未成功");
        return;
      }
      clearTimeout(deadline);
      relay = true;
      setPath("正在连接中转");
      try {
        pc.setConfiguration(__spreadProps(__spreadValues({}, pc.getConfiguration()), { iceServers: servers, iceTransportPolicy: "all" }));
        pc.restartIce();
        Promise.resolve(negotiate()).catch(() => setPath("网络连接不稳定"));
      } catch (e) {
        setPath("网络连接不稳定");
      }
    }
    function update() {
      if (!valid()) return;
      if (connected()) {
        clearTimeout(deadline);
        clearTimeout(recovery);
        recovery = null;
        stats();
        return;
      }
      if (pc.iceConnectionState === "failed" || pc.connectionState === "failed") {
        if (!relay) fallback();
        else if (restarts++ < 2) {
          setPath("正在重连");
          pc.restartIce();
          Promise.resolve(negotiate()).catch(() => {
          });
        } else setPath("网络连接不稳定");
      } else if (pc.iceConnectionState === "disconnected" && !recovery) {
        setPath("正在重连");
        recovery = setTimeout(() => {
          recovery = null;
          fallback();
        }, 5e3);
      }
    }
    deadline = setTimeout(fallback, policy.directTimeoutMs || 15e3);
    statsTimer = setInterval(stats, 2500);
    return { update, get path() {
      return path;
    }, get rtt() {
      return rtt;
    }, get available() {
      return available;
    }, close() {
      closed = true;
      clearTimeout(deadline);
      clearTimeout(recovery);
      clearInterval(statsTimer);
    } };
  }
  function directIceServers(policy) {
    return (policy.iceServers || []).map((s) => __spreadProps(__spreadValues({}, s), { urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => /^stun:/.test(u)) })).filter((s) => s.urls.length);
  }

  // internal/ui/src/microphone-meter.js
  function microphoneMeter(track, node) {
    if (!track || !node) return null;
    let context, source, analyser, frame = 0, last = 0, level = 0, closed = false;
    const bars = [...node.children], history = Array(bars.length).fill(0), values = new Float32Array(512);
    const display = (value) => {
      node.dataset.level = String(Math.round(value * 100));
      node.setAttribute("aria-valuenow", String(Math.round(value * 100)));
      if (value <= 0) history.fill(0);
      else {
        history.shift();
        history.push(value);
      }
      bars.forEach((bar, i) => {
        bar.style.height = Math.max(15, history[i] * 100) + "%";
        bar.classList.toggle("active", history[i] > 0.02);
      });
    };
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      source = context.createMediaStreamSource(new MediaStream([track]));
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      context.resume().catch(() => {
      });
      const draw = (time) => {
        if (closed) return;
        frame = requestAnimationFrame(draw);
        if (time - last < 90) return;
        last = time;
        analyser.getFloatTimeDomainData(values);
        let sum = 0;
        for (const value of values) sum += value * value;
        const sample = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(Math.sqrt(sum / values.length), 1e-6)) + 60) / 60));
        level = track.enabled && track.readyState === "live" ? Math.max(sample, level * 0.65) : 0;
        display(level);
      };
      frame = requestAnimationFrame(draw);
    } catch (e) {
      source == null ? void 0 : source.disconnect();
      context == null ? void 0 : context.close().catch(() => {
      });
      display(0);
      return null;
    }
    return { track, close() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      context.close().catch(() => {
      });
      display(0);
    } };
  }

  // internal/ui/src/meetings.js
  function createMeetings({ api: api2, action: action2, S: S2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, Desktop: Desktop2, onCallClosed, callCurrent, historyEntry }) {
    let room = null, nativeCall = null, pending = /* @__PURE__ */ new Map(), checkingInvitation = false;
    const el = (id) => document.getElementById(id);
    const display = meetingWindow({ active: () => !!room, toast: toast2, changed: (full) => {
      const b = el("meeting-fullscreen");
      if (b) {
        b.classList.toggle("on", full);
        b.querySelector("span").textContent = full ? "退出全屏" : "全屏";
        b.setAttribute("aria-pressed", String(full));
      }
    } });
    async function minimize() {
      if (!room) return;
      try {
        await display.exit();
        if (room) {
          root().classList.add("meeting-minimized");
          toast2("会议继续进行，点击“返回会议”恢复");
        }
      } catch (e) {
        toast2("暂时无法最小化，请先退出全屏");
      }
    }
    const root = () => {
      let n = el("meeting-layer");
      if (!n) {
        n = document.createElement("div");
        n.id = "meeting-layer";
        document.body.append(n);
      }
      return n;
    };
    function invitationText(code) {
      return "邀请你加入 LinkMe 会议\n会议号：" + grouped(code) + "\n会议链接：" + S2.config.server.replace(/\/$/, "") + "/join/" + code;
    }
    async function copyInvitation(code) {
      const text = invitationText(code);
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.append(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) {
          modal2("会议邀请", '<textarea readonly style="width:100%;height:120px">' + esc2(text) + "</textarea>");
          return;
        }
      }
      toast2("邀请链接和会议号已复制");
    }
    function parseInvitation(raw) {
      const compact = raw.trim().replace(/\s/g, "");
      if (/^[1-9]\d{8}$/.test(compact)) return compact;
      const link = raw.match(/https?:\/\/[^\s]+/);
      if (link) {
        let url;
        try {
          url = new URL(link[0]);
        } catch (e) {
          throw Error("会议链接无效");
        }
        ;
        if (url.origin !== new URL(S2.config.server).origin) throw Error("会议链接的服务器与当前连接不同");
        const match = url.pathname.match(/^\/join\/([1-9]\d{8})$/);
        if (!match || url.search || url.hash) throw Error("会议链接无效");
        return match[1];
      }
      const code = raw.match(/会议号[：:]\s*([1-9]\d{2}\s?\d{3}\s?\d{3})(?!\d)/);
      if (code) return code[1].replace(/\s/g, "");
      throw Error("请粘贴有效的会议邀请链接或 9 位会议号");
    }
    async function checkNativeInvitation(force = false) {
      var _a, _b;
      if (checkingInvitation || !S2.user || S2.signingOut || room || nativeCall || document.querySelector("#call-layer") || !force && document.querySelector(".modal")) return;
      checkingInvitation = true;
      try {
        const code = ((_a = window.WeLinkAndroid) == null ? void 0 : _a.takeMeetingInvitation) ? window.WeLinkAndroid.takeMeetingInvitation() : window.welinkMeetingInvitation ? await window.welinkMeetingInvitation() : ((_b = await api2("/local/meeting-invitation").catch(() => null)) == null ? void 0 : _b.code) || "";
        if (code && S2.user && !S2.signingOut) openJoin(code);
      } catch (e) {
      } finally {
        checkingInvitation = false;
      }
    }
    setInterval(checkNativeInvitation, 1500);
    window.addEventListener("welink-open-meeting", () => checkNativeInvitation(true));
    const grouped = (code) => String(code).replace(/(\d{3})(?=\d)/g, "$1 ");
    function send(message) {
      if ((room == null ? void 0 : room.ws.readyState) === 1) room.ws.send(JSON.stringify(message));
    }
    function state() {
      if (!(room == null ? void 0 : room.id)) return;
      startMicrophoneMeter(room);
      const local = room.states.get(room.id);
      if (!local) return;
      local.microphone = room.stream.getAudioTracks().some((t) => t.enabled);
      local.camera = room.stream.getVideoTracks().some((t) => t.enabled);
      local.screen = !!room.screen;
      local.recording = !!room.recording;
      send(__spreadValues({ type: "state" }, local));
      renderMembers();
      updateButtons();
    }
    function renderHome() {
      Desktop2 == null ? void 0 : Desktop2.clearActivities("meeting/");
      const n = document.querySelector("#main-content");
      n.innerHTML = '<section class="utility meeting-home"><h2>会议</h2><p class="hint">和好友一起面对面交流，也可以分享屏幕。</p><div class="meeting-cards"><button data-action="meeting-create">'.concat(icon2("video"), '<b>发起会议</b><span>邀请好友或群成员</span></button><button data-action="meeting-join">').concat(icon2("plus"), "<b>加入会议</b><span>输入 9 位会议号</span></button></div>").concat(historyEntry(), '<h3>正在进行</h3><div id="meeting-list">正在读取…</div></section>');
      api2("/api/meetings").then((items) => {
        if (!el("meeting-list")) return;
        el("meeting-list").innerHTML = items.map((m) => '<button class="utility-row meeting-open-row" data-meeting-code="'.concat(m.code, '">').concat(icon2("video"), '<div class="body"><b>').concat(esc2(m.title), "</b><p>").concat(grouped(m.code), " · ").concat(m.count, " 人</p></div><span>进入</span></button>")).join("") || '<div class="empty-list">暂无进行中的会议</div>';
      }).catch((e) => toast2(e.message));
    }
    function openCreate(cid = "", mode = "video") {
      if (room) {
        show();
        return;
      }
      modal2(mode === "audio" ? "发起语音通话" : "发起会议", '<label>会议名称</label><input id="meeting-title" maxlength="60" value="'.concat(esc2(mode === "audio" ? S2.user.name + "的语音通话" : S2.user.name + "的会议"), '"><p class="hint">').concat(cid ? "将邀请当前会话成员加入。" : "创建后可邀请好友，或分享会议号。", "最多 ").concat(S2.policy.meetingMaxParticipants || 8, " 人，最长 ").concat(S2.policy.meetingDurationMinutes || 120, ' 分钟。</p><label class="check-row"><input type="checkbox" id="meeting-mic" checked>入会时开启麦克风</label><label class="check-row"><input type="checkbox" id="meeting-camera" >入会时开启摄像头</label>'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-create-submit">立即开始</button>');
      el("meeting-create-submit").onclick = async () => {
        const button = el("meeting-create-submit");
        button.disabled = true;
        const mic = el("meeting-mic").checked, cam = el("meeting-camera").checked;
        try {
          const m = await action2("/api/meetings", { title: el("meeting-title").value, conversationId: cid });
          await join(m.code, mic, cam, true);
        } catch (e) {
          toast2(e.message);
        } finally {
          button.disabled = false;
        }
      };
    }
    function openJoin(code = "") {
      if (room) {
        show();
        return;
      }
      modal2("加入会议", '<label>会议链接或会议号</label><input id="meeting-code" maxlength="1000" placeholder="粘贴会议邀请链接或输入 9 位会议号" value="'.concat(esc2(code), '"><label class="check-row"><input type="checkbox" id="meeting-mic" checked>开启麦克风</label><label class="check-row"><input type="checkbox" id="meeting-camera">开启摄像头</label>'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-join-submit">加入会议</button>');
      el("meeting-join-submit").onclick = async () => {
        const b = el("meeting-join-submit");
        b.disabled = true;
        try {
          await join(parseInvitation(el("meeting-code").value), el("meeting-mic").checked, el("meeting-camera").checked);
        } catch (e) {
          toast2(e.message);
        } finally {
          b.disabled = false;
        }
      };
    }
    async function initialMedia(mic, cam) {
      var _a;
      if (!mic && !cam) return new MediaStream();
      if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getUserMedia)) throw Error("当前系统缺少音视频组件");
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: mic ? { echoCancellation: true, noiseSuppression: true } : false, video: cam ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } : false });
      } catch (e) {
        toast2("设备未开启，可在会议中重新启用：" + e.message);
        return new MediaStream();
      }
    }
    async function join(code, mic = false, cam = false, host = false, call = null) {
      var _a, _b, _c;
      if (!/^[1-9]\d{8}$/.test(code)) throw Error("请输入 9 位会议号");
      if (room) {
        if (call && ((_a = room.call) == null ? void 0 : _a.id) !== call.id) throw Error("请先结束当前会议");
        show();
        return;
      }
      if (!call) await api2("/api/meetings/" + code);
      const joiningToken = S2.token, rtc = await api2("/api/rtc-config");
      if (joiningToken !== S2.token || !S2.user || call && !callCurrent(call.id)) return;
      if (call && ((_b = window.WeLinkAndroid) == null ? void 0 : _b.openCall)) {
        nativeCall = call.id;
        window.WeLinkAndroid.openCall(code, S2.token, S2.user.name, call.id, call.peer.name, call.mode, JSON.stringify(rtc));
        return;
      }
      if ((_c = window.WeLinkAndroid) == null ? void 0 : _c.openMeeting) {
        window.WeLinkAndroid.openMeeting(code, S2.token, S2.user.name, host, mic, cam, S2.config.server, JSON.stringify(rtc));
        closeModal2();
        return;
      }
      const owner2 = S2.token, stream = await initialMedia(mic, cam);
      if (owner2 !== S2.token || !S2.user || call && !callCurrent(call.id)) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (call && !stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("未获得麦克风权限，请检查权限后重试");
      }
      const ws = new WebSocket("ws://".concat(location.host, "/api/meetings/").concat(code, "/ws"));
      room = { code, ws, stream, call, rtc, id: "", host: "", states: /* @__PURE__ */ new Map(), peers: /* @__PURE__ */ new Map(), tiles: /* @__PURE__ */ new Map(), screen: null, recording: null, ping: null, started: Date.now(), intentional: false };
      const active = room;
      renderRoom();
      if (call) {
        root().classList.add("call-mode");
        root().classList.toggle("call-audio", call.mode === "audio");
        root().querySelector(".meeting-top b").textContent = call.peer.name;
        el("meeting-leave").textContent = "挂断";
        tile(call.peer.id, call.peer.name, null);
        active.callClock = setInterval(() => {
          if (room === active && call.started) renderConnection(active);
        }, 1e3);
      }
      closeModal2();
      ws.onmessage = (event) => {
        if (room !== active) return;
        let m;
        try {
          m = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        receive(m).catch((e) => toast2("会议信令处理失败：" + e.message));
      };
      ws.onopen = () => {
        active.ping = setInterval(() => send({ type: "ping" }), 2e4);
      };
      ws.onclose = () => {
        if (room === active) {
          const reason = active.id ? "会议连接已断开" : "无法入会，请核对会议号、等待主持人入会或检查是否已满";
          cleanup(active);
          if (!active.intentional) toast2(reason);
        }
      };
    }
    function renderConnection(active) {
      var _a;
      if (room !== active || !el("meeting-network")) return;
      for (const p of active.peers.values()) tuneMeetingPeer(p, !!active.screen, active.peers.size);
      const paths2 = [...active.peers.values()].map((p) => p.route.path);
      let label = paths2.includes("中转连接") ? "中转连接" : paths2.length && paths2.every((p) => p === "P2P 直连") ? "P2P 直连" : paths2.find((p) => p !== "P2P 直连") || "等待其他成员";
      if ((_a = active.call) == null ? void 0 : _a.started) label = formatDuration((Date.now() - active.call.started) / 1e3) + " · " + label;
      const rtt = Math.max(-1, ...[...active.peers.values()].map((p) => p.route.rtt));
      el("meeting-network").textContent = label + (rtt >= 0 ? " · " + rtt + " ms" : "");
    }
    function renderRoom() {
      root().innerHTML = '<section class="meeting-room"><header class="meeting-top"><b>LinkMe 会议</b><button id="meeting-copy" title="复制邀请链接和会议号">'.concat(grouped(room.code), " ").concat(icon2("copy"), '</button><span id="meeting-network">正在连接…</span><button id="meeting-minimize" title="最小化会议" aria-label="最小化会议">').concat(icon2("minus"), '</button></header><button id="meeting-restore">返回会议</button><button id="meeting-mini-leave" title="离开会议">离开</button><div class="meeting-content"><div id="meeting-grid" class="meeting-grid"></div><aside class="meeting-members"><h3>成员 <span id="meeting-count"></span></h3><div id="meeting-members-list"></div><button class="secondary" id="meeting-invite">邀请好友</button><p class="meeting-record-indicator hidden" id="meeting-recording">● 主持人正在录制</p></aside></div><footer class="meeting-tools"><button id="meeting-audio">').concat(icon2("phone"), '<span>麦克风</span></button><button id="meeting-video">').concat(icon2("video"), '<span>摄像头</span></button><button id="meeting-share">').concat(icon2("monitor"), '<span>共享屏幕</span></button><button id="meeting-record">').concat(icon2("file"), '<span>录制</span></button><button id="meeting-fullscreen">').concat(icon2("maximize"), '<span>全屏</span></button><button id="meeting-leave" class="meeting-leave">离开会议</button><button id="meeting-end" class="meeting-end">结束会议</button></footer></section>');
      el("meeting-copy").onclick = () => {
        if (root().classList.contains("meeting-minimized")) {
          show();
          return;
        }
        copyInvitation(room.code);
      };
      el("meeting-minimize").onclick = minimize;
      el("meeting-restore").onclick = show;
      el("meeting-mini-leave").onclick = () => leave(false);
      for (const [id, fn] of [["meeting-audio", () => toggle("audio")], ["meeting-video", () => toggle("video")], ["meeting-share", share], ["meeting-record", record]]) el(id).onclick = () => fn().catch((e) => toast2(e.message));
      el("meeting-fullscreen").onclick = display.toggle;
      const meter = document.createElement("div");
      meter.id = "meeting-mic-level";
      meter.className = "microphone-level";
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", "麦克风输入音量");
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-valuenow", "0");
      meter.innerHTML = "<i></i>".repeat(7);
      el("meeting-audio").append(meter);
      startMicrophoneMeter(room);
      el("meeting-invite").onclick = invite;
      el("meeting-leave").onclick = () => leave(false);
      el("meeting-end").onclick = () => leave(true);
      updateButtons();
    }
    function startMicrophoneMeter(active) {
      var _a, _b;
      if (room !== active) return;
      const track = active.stream.getAudioTracks()[0];
      if (((_a = active.microphoneMeter) == null ? void 0 : _a.track) === track) return;
      (_b = active.microphoneMeter) == null ? void 0 : _b.close();
      active.microphoneMeter = microphoneMeter(track, el("meeting-mic-level"));
    }
    function show() {
      if (room) root().classList.remove("meeting-minimized");
      else openJoin();
    }
    function tile(id, name, stream, self = false) {
      let n = room.tiles.get(id);
      if (!n) {
        n = document.createElement("div");
        n.className = "meeting-tile";
        n.innerHTML = '<video autoplay playsinline></video><div class="meeting-person"></div><div class="meeting-sharing-status">正在共享屏幕<br><small>本机不回显共享画面</small></div><div class="meeting-tile-label"></div>';
        room.tiles.set(id, n);
        el("meeting-grid").append(n);
        n.classList.toggle("meeting-self", self);
      }
      ;
      const v = n.querySelector("video");
      v.muted = self;
      if (stream && v.srcObject !== stream) {
        v.srcObject = stream;
        v.play().catch(() => {
        });
      }
      ;
      n.querySelector(".meeting-person").textContent = (name || "M").slice(0, 1);
      n.querySelector(".meeting-tile-label").textContent = (self ? "我 · " : "") + name;
      return n;
    }
    function renderMembers() {
      if (!room) return;
      el("meeting-count").textContent = room.states.size;
      const columns = room.states.size <= 2 ? room.states.size : room.states.size <= 4 ? 2 : 3;
      el("meeting-grid").style.gridTemplateColumns = "repeat(".concat(innerWidth <= 700 ? 1 : columns, ",minmax(0,1fr))");
      el("meeting-grid").style.gridTemplateRows = "repeat(".concat(Math.ceil(room.states.size / (innerWidth <= 700 ? 1 : columns)), ",minmax(0,1fr))");
      el("meeting-members-list").innerHTML = [...room.states.entries()].map(([id, p]) => '<div class="meeting-member"><b>'.concat(esc2(p.name)).concat(id === room.id ? "（我）" : "", "</b><small>").concat(id === room.host ? "主持人 · " : "").concat(p.microphone ? "麦克风开启" : "已静音", "</small>").concat(room.id === room.host && id !== room.id ? '<div><button data-meeting-mute="'.concat(id, '">静音</button><button data-meeting-transfer="').concat(id, '">设为主持人</button><button data-meeting-kick="').concat(id, '">移出</button></div>') : "", "</div>")).join("");
      for (const [id, p] of room.states) {
        const n = room.tiles.get(id);
        if (n) {
          n.classList.toggle("has-video", !(id === room.id && p.screen) && (!!p.camera || !!p.screen));
          n.classList.toggle("is-screen", !!p.screen);
          n.classList.toggle("sharing-local", id === room.id && !!p.screen);
        }
      }
      el("meeting-recording").classList.toggle("hidden", ![...room.states.values()].some((p) => p.recording));
      el("meeting-members-list").onclick = (e) => {
        for (const type of ["mute", "transfer", "kick"]) {
          const b = e.target.closest("[data-meeting-".concat(type, "]"));
          if (b) send({ type, to: b.getAttribute("data-meeting-".concat(type)) });
        }
      };
    }
    function updateButtons() {
      if (!room) return;
      const local = room.states.get(room.id), host = room.id && room.id === room.host;
      el("meeting-audio").classList.toggle("on", !!(local == null ? void 0 : local.microphone));
      el("meeting-video").classList.toggle("on", !!(local == null ? void 0 : local.camera));
      el("meeting-share").disabled = !host;
      el("meeting-record").disabled = !host;
      el("meeting-share").classList.toggle("on", !!room.screen);
      el("meeting-record").classList.toggle("on", !!room.recording);
      el("meeting-end").classList.toggle("hidden", !host);
    }
    function peer(id) {
      var _a;
      if (room.peers.has(id)) return room.peers.get(id);
      const active = room, pc = new RTCPeerConnection({ iceServers: directIceServers(active.rtc), iceTransportPolicy: "all", bundlePolicy: "max-bundle" }), entry = { id, pc, makingOffer: false, queue: [], ignore: false, signals: Promise.resolve(), pendingSignals: 0, needsOffer: false, localOffer: null };
      room.peers.set(id, entry);
      entry.route = directFirstICE(pc, active.rtc, { alive: () => room === active && active.peers.get(id) === entry, changed: () => renderConnection(active), negotiate: () => offer(entry) });
      for (const track of room.stream.getAudioTracks()) pc.addTrack(track, room.stream);
      const video = ((_a = room.screen) == null ? void 0 : _a.getVideoTracks()[0]) || room.stream.getVideoTracks()[0];
      if (video) pc.addTrack(video, room.screen || room.stream);
      if (!room.stream.getAudioTracks().length) pc.addTransceiver("audio", { direction: "recvonly" });
      if (!video) pc.addTransceiver("video", { direction: "recvonly" });
      pc.onicecandidate = (e) => {
        if (e.candidate && room === active) send({ type: "signal", to: id, signal: "candidate", candidate: JSON.stringify(e.candidate.toJSON()) });
      };
      pc.ontrack = (e) => {
        if (room !== active) return;
        const p = room.states.get(id);
        let stream = e.streams[0];
        if (!stream) {
          stream = new MediaStream();
          stream.addTrack(e.track);
        }
        tile(id, (p == null ? void 0 : p.name) || "参会者", stream);
        renderMembers();
      };
      pc.onnegotiationneeded = () => offer(entry).catch((e) => toast2(e.message));
      const connectionChanged = () => {
        if (room !== active) return;
        if (active.call && (pc.connectionState === "connected" || ["connected", "completed"].includes(pc.iceConnectionState))) send({ type: "call-connected" });
        entry.route.update();
        renderConnection(active);
      };
      pc.onconnectionstatechange = connectionChanged;
      pc.oniceconnectionstatechange = connectionChanged;
      return entry;
    }
    async function offer(p) {
      const active = room;
      if (!active || active.peers.get(p.id) !== p) return;
      if (p.pendingSignals) {
        p.needsOffer = true;
        return;
      }
      if (p.makingOffer || p.pc.signalingState !== "stable") return;
      p.needsOffer = false;
      const epoch = p.offerEpoch = (p.offerEpoch || 0) + 1, live = () => room === active && active.peers.get(p.id) === p && p.offerEpoch === epoch;
      let setting = null;
      try {
        p.makingOffer = true;
        const description = await p.pc.createOffer();
        if (!live()) return;
        setting = p.localOffer = p.pc.setLocalDescription(description);
        await setting;
        if (live()) send({ type: "signal", to: p.id, signal: "offer", sdp: p.pc.localDescription.sdp });
      } catch (error) {
        if (live()) throw error;
      } finally {
        if (p.localOffer === setting) p.localOffer = null;
        if (p.offerEpoch === epoch) p.makingOffer = false;
      }
    }
    function signal(active, p, m) {
      const live = () => room === active && active.peers.get(p.id) === p;
      p.pendingSignals++;
      const task = p.signals.then(async () => {
        try {
          if (live()) await receiveSignal(active, p, m, live);
        } catch (error) {
          if (live()) throw error;
        } finally {
          p.pendingSignals--;
          if (!p.pendingSignals && p.needsOffer && live()) offer(p).catch((e) => toast2(e.message));
        }
      });
      p.signals = task.catch(() => {
      });
      return task;
    }
    async function receiveSignal(active, p, m, live) {
      const pc = p.pc;
      if (m.signal === "candidate") {
        if (p.ignore) return;
        const c = JSON.parse(m.candidate);
        if (pc.remoteDescription) await pc.addIceCandidate(c);
        else if (p.queue.length < 64) p.queue.push(c);
        return;
      }
      const collision = m.signal === "offer" && (p.makingOffer || pc.signalingState !== "stable"), polite = active.id > m.from;
      p.ignore = !polite && collision;
      if (p.ignore) {
        p.queue.length = 0;
        return;
      }
      if (collision) {
        p.offerEpoch = (p.offerEpoch || 0) + 1;
        p.makingOffer = false;
        if (p.localOffer) await p.localOffer.catch(() => {
        });
        if (!live()) return;
        if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
        if (!live()) return;
      }
      await pc.setRemoteDescription({ type: m.signal, sdp: m.sdp });
      if (!live()) return;
      for (const c of p.queue.splice(0)) {
        await pc.addIceCandidate(c);
        if (!live()) return;
      }
      if (m.signal === "offer") {
        const answer = await pc.createAnswer();
        if (!live()) return;
        await pc.setLocalDescription(answer);
        if (live()) send({ type: "signal", to: p.id, signal: "answer", sdp: pc.localDescription.sdp });
      }
    }
    async function receive(m) {
      var _a, _b, _c;
      if (!room) return;
      if (m.type === "call-state" && room.call) {
        room.call.started = m.started || 0;
        return;
      }
      if (m.type === "welcome") {
        const active = room;
        room.id = m.id;
        room.host = m.host;
        room.states.set(m.id, { name: S2.user.name });
        tile(m.id, S2.user.name, room.stream, true);
        for (const p of m.peers || []) {
          room.states.set(p.id, p);
          tile(p.id, p.name);
          await offer(peer(p.id));
          if (room !== active) return;
        }
        el("meeting-network").textContent = "会议进行中";
        state();
        return;
      }
      if (m.type === "peer-joined") {
        room.states.set(m.id, { name: m.name });
        tile(m.id, m.name);
        renderMembers();
        state();
        return;
      }
      if (m.type === "peer-left") {
        (_a = room.peers.get(m.id)) == null ? void 0 : _a.route.close();
        (_b = room.peers.get(m.id)) == null ? void 0 : _b.pc.close();
        room.peers.delete(m.id);
        (_c = room.tiles.get(m.id)) == null ? void 0 : _c.remove();
        room.tiles.delete(m.id);
        room.states.delete(m.id);
        renderMembers();
        return;
      }
      if (m.type === "state") {
        const p = room.states.get(m.id);
        if (p) Object.assign(p, { microphone: !!m.microphone, camera: !!m.camera, screen: !!m.screen, recording: !!m.recording });
        renderMembers();
        return;
      }
      if (m.type === "host") {
        room.host = m.host;
        if (room.id !== room.host) {
          await stopSharing();
          stopRecording();
        }
        updateButtons();
        renderMembers();
        return;
      }
      if (m.type === "mute") {
        room.stream.getAudioTracks().forEach((t) => t.enabled = false);
        state();
        toast2("主持人已将你的麦克风静音");
        return;
      }
      if (m.type === "ended") {
        const active = room;
        active.intentional = true;
        cleanup(active);
        toast2(m.message || "会议已结束");
        return;
      }
      if (m.type === "signal") return signal(room, peer(m.from), m);
    }
    async function toggle(kind) {
      var _a;
      const active = room;
      if (!active) return;
      (_a = active.pendingMedia) != null ? _a : active.pendingMedia = /* @__PURE__ */ new Set();
      if (active.pendingMedia.has(kind)) return;
      active.pendingMedia.add(kind);
      try {
        const tracks = kind === "audio" ? active.stream.getAudioTracks() : active.stream.getVideoTracks();
        if (tracks.length) tracks.forEach((t) => t.enabled = !t.enabled);
        else {
          const stream = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio: { echoCancellation: true } } : { video: true });
          if (room !== active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          for (const t of stream.getTracks()) {
            active.stream.addTrack(t);
            for (const p of active.peers.values()) {
              if (room !== active) return;
              if (kind === "video" && active.screen) continue;
              const sender = p.pc.getSenders().find((s) => {
                var _a2;
                return ((_a2 = s.track) == null ? void 0 : _a2.kind) === kind;
              });
              if (sender) await sender.replaceTrack(t);
              else p.pc.addTrack(t, active.stream);
            }
          }
        }
        if (room !== active) return;
        if (!active.screen) tile(active.id, S2.user.name, active.stream, true);
        state();
      } finally {
        active.pendingMedia.delete(kind);
      }
    }
    async function replaceVideo(track, stream) {
      for (const p of room.peers.values()) {
        const transceiver = p.pc.getTransceivers().find((t) => {
          var _a, _b;
          return ((_a = t.sender.track) == null ? void 0 : _a.kind) === "video" || ((_b = t.receiver.track) == null ? void 0 : _b.kind) === "video";
        });
        if (transceiver) {
          if (track && transceiver.direction === "recvonly") transceiver.direction = "sendrecv";
          await transceiver.sender.replaceTrack(track);
        } else if (track) p.pc.addTrack(track, stream);
        p.tuningKey = "";
        await tuneMeetingPeer(p, !!room.screen, room.peers.size);
      }
    }
    async function share() {
      var _a;
      const active = room;
      if (!active || active.id !== active.host || active.sharePending) return;
      if (active.screen) {
        await stopSharing();
        return;
      }
      if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getDisplayMedia)) throw Error("当前系统不支持屏幕共享");
      active.sharePending = true;
      el("meeting-share").disabled = true;
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false, selfBrowserSurface: "exclude" });
        if (room !== active || active.id !== active.host) {
          screen.getTracks().forEach((t) => t.stop());
          return;
        }
        active.screen = screen;
        screen.getVideoTracks()[0].onended = () => {
          if (room === active) stopSharing().catch((e) => toast2(e.message));
        };
        try {
          await replaceVideo(screen.getVideoTracks()[0], screen);
        } catch (e) {
          await stopSharing();
          throw e;
        }
        if (room !== active) return;
        tile(active.id, S2.user.name, active.stream, true);
        state();
        toast2("正在共享屏幕，本机已关闭共享画面回显");
      } catch (e) {
        if (e.name !== "NotAllowedError" && e.name !== "AbortError") throw e;
      } finally {
        active.sharePending = false;
        if (room === active) updateButtons();
      }
    }
    async function stopSharing() {
      if (!(room == null ? void 0 : room.screen)) return;
      const active = room, screen = active.screen;
      active.screen = null;
      screen.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      await replaceVideo(active.stream.getVideoTracks()[0] || null, active.stream);
      if (room !== active) return;
      tile(active.id, S2.user.name, active.stream, true);
      state();
    }
    async function record() {
      if (!room || room.id !== room.host) return;
      if (room.recording) {
        stopRecording();
        return;
      }
      if (typeof MediaRecorder === "undefined") throw Error("当前系统不支持录制");
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d"), stream = canvas.captureStream(15), audio = new AudioContext(), destination = audio.createMediaStreamDestination(), sources = [];
      for (const n of room.tiles.values()) {
        const media = n.querySelector("video").srcObject;
        if (media == null ? void 0 : media.getAudioTracks().length) {
          const source = audio.createMediaStreamSource(media);
          source.connect(destination);
          sources.push(source);
        }
      }
      stream.addTrack(destination.stream.getAudioTracks()[0]);
      const mime = ["video/webm;codecs=vp8,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x)), recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : void 0), capture = { recorder, stream, audio, sources, chunks: [], timer: null, code: room.code };
      room.recording = capture;
      capture.timer = setInterval(() => {
        if (!room) return;
        const tiles = [...room.tiles.values()], cols = Math.ceil(Math.sqrt(tiles.length)), rows = Math.ceil(tiles.length / cols), w = 1280 / cols, h = 720 / rows;
        ctx.fillStyle = "#f5f6f7";
        ctx.fillRect(0, 0, 1280, 720);
        tiles.forEach((n, i) => {
          try {
            ctx.drawImage(n.querySelector("video"), i % cols * w, Math.floor(i / cols) * h, w, h);
          } catch (e) {
          }
          ctx.fillStyle = "#22262b";
          ctx.font = "20px sans-serif";
          ctx.fillText(n.querySelector(".meeting-tile-label").textContent, i % cols * w + 12, (Math.floor(i / cols) + 1) * h - 18);
        });
      }, 67);
      recorder.ondataavailable = (e) => {
        if (e.data.size) capture.chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(capture.chunks, { type: mime || "video/webm" }), a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "LinkMe-会议-".concat(capture.code, "-").concat(Date.now(), ".webm");
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3e4);
        stream.getTracks().forEach((t) => t.stop());
        sources.forEach((s) => s.disconnect());
        audio.close();
      };
      recorder.start(1e3);
      state();
    }
    function stopRecording() {
      if (!(room == null ? void 0 : room.recording)) return;
      const r = room.recording;
      room.recording = null;
      clearInterval(r.timer);
      if (r.recorder.state !== "inactive") r.recorder.stop();
      state();
    }
    function invite() {
      const active = room;
      if (!active) return;
      modal2("邀请好友入会", '<p class="hint">会议号：' + grouped(active.code) + '</p><button class="secondary" id="meeting-copy-invitation">复制邀请链接和会议号</button><label for="meeting-invite-search">搜索姓名或 6 位账号</label><input id="meeting-invite-search" placeholder="搜索用户"><div id="meeting-invite-results" class="member-select"></div>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-send-invites">发送邀请</button>');
      const panel = el("meeting-invite-results"), selected = /* @__PURE__ */ new Map();
      let version = 0, timer;
      const valid = () => room === active && panel.isConnected;
      function render(users) {
        if (!valid()) return;
        const found = new Map([...selected, ...users.filter((u) => u.id !== S2.user.id && !active.states.has(u.id)).map((u) => [u.id, u])]);
        panel.innerHTML = [...found.values()].map((u) => '<label class="check-row">' + esc2(u.remark || u.name) + " · " + esc2(u.number) + '<input type="checkbox" value="' + u.id + '" name="meeting-invite-user" ' + (selected.has(u.id) ? "checked" : "") + "></label>").join("") || '<p class="hint">暂无可邀请的联系人，可搜索用户或复制邀请链接。</p>';
        panel.onchange = (e) => {
          const u = found.get(e.target.value);
          if (u) {
            if (e.target.checked) selected.set(u.id, u);
            else selected.delete(u.id);
          }
        };
      }
      render(S2.friends);
      el("meeting-invite-search").oninput = (e) => {
        clearTimeout(timer);
        const q = e.target.value.trim(), v = ++version;
        if (!q) {
          render(S2.friends);
          return;
        }
        timer = setTimeout(async () => {
          try {
            const users = await api2("/api/users?q=" + encodeURIComponent(q));
            if (v === version) render(users);
          } catch (e2) {
            if (valid() && v === version) toast2(e2.message);
          }
        }, 220);
      };
      el("meeting-copy-invitation").onclick = () => copyInvitation(active.code);
      const button = el("meeting-send-invites");
      button.onclick = async () => {
        if (!valid()) return;
        if (!selected.size) {
          el("modal-error").textContent = "请选择要邀请的好友";
          return;
        }
        button.disabled = true;
        try {
          await action2("/api/meetings/" + active.code + "/invite", { members: [...selected.keys()] });
          if (valid()) {
            closeModal2();
            toast2("会议邀请已发送");
          }
        } catch (e) {
          if (valid()) {
            el("modal-error").textContent = e.message;
            button.disabled = false;
          }
        }
      };
    }
    function invitationSound() {
      if (window.WeLinkAndroid) return;
      try {
        const audio = new (window.AudioContext || window.webkitAudioContext)();
        audio.resume().catch(() => {
        });
        for (let i = 0; i < 3; i++) {
          const tone = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * 0.18;
          tone.frequency.value = [523, 659, 784][i];
          gain.gain.setValueAtTime(0.025, at);
          gain.gain.exponentialRampToValueAtTime(1e-3, at + 0.26);
          tone.connect(gain);
          gain.connect(audio.destination);
          tone.start(at);
          tone.stop(at + 0.27);
        }
        setTimeout(() => audio.close(), 1100);
      } catch (e) {
      }
    }
    function dismissInvitation(code, clearNative = true) {
      var _a, _b, _c;
      pending.delete(code);
      (_a = document.querySelector('[data-meeting-notice="' + code + '"]')) == null ? void 0 : _a.remove();
      if (clearNative) (_c = (_b = window.WeLinkAndroid) == null ? void 0 : _b.dismissNativeInvite) == null ? void 0 : _c.call(_b, "meeting:" + code);
    }
    async function invited(m) {
      var _a;
      if (!S2.user || !/^[1-9]\d{8}$/.test(m.code) || pending.has(m.code)) return;
      const owner2 = S2.token;
      pending.set(m.code, m);
      if (window.welinkMeetingNotify) {
        try {
          const handled = await window.welinkMeetingNotify(m.code, m.title, m.expires || Date.now() + 72e5);
          if (owner2 !== S2.token) {
            (_a = window.welinkMeetingClear) == null ? void 0 : _a.call(window);
            return;
          }
          if (handled) {
            pending.delete(m.code);
            return;
          }
        } catch (e) {
        }
      }
      if (S2.config.platform === "windows" || innerWidth > 700 && !window.WeLinkAndroid) {
        pending.delete(m.code);
        return;
      }
      invitationSound();
      let area = el("meeting-invitations");
      if (!area) {
        area = document.createElement("div");
        area.id = "meeting-invitations";
        document.body.append(area);
      }
      const box = document.createElement("section");
      box.className = "meeting-invitation-notice";
      box.dataset.meetingNotice = m.code;
      box.setAttribute("role", "alert");
      box.innerHTML = '<header><b>LinkMe · 会议邀请</b><button data-meeting-notice-close title="关闭">'.concat(icon2("close"), "</button></header><h3>").concat(esc2(m.title), "</h3><p>会议号 ").concat(grouped(m.code), '</p><footer><button data-meeting-notice-close>忽略</button><button class="primary" data-meeting-notice-enter>进入会议</button></footer>');
      area.append(box);
      box.querySelectorAll("[data-meeting-notice-close]").forEach((b) => b.onclick = () => dismissInvitation(m.code));
      box.querySelector("[data-meeting-notice-enter]").onclick = () => nativeAction(m.code, true);
    }
    function ended(m) {
      if (!(m == null ? void 0 : m.code)) return;
      dismissInvitation(m.code);
      Desktop2 == null ? void 0 : Desktop2.activity("meeting/" + m.code, false);
    }
    function nativeAction(code, accept) {
      dismissInvitation(code);
      if (accept) openJoin(code);
    }
    function clearInvitations() {
      var _a, _b;
      pending.clear();
      (_a = el("meeting-invitations")) == null ? void 0 : _a.remove();
      (_b = window.welinkMeetingClear) == null ? void 0 : _b.call(window);
    }
    function leave(end) {
      const active = room;
      if (!active) return;
      if (active.call) {
        send({ type: "call-end" });
        active.intentional = true;
        cleanup(active);
        action2("/api/calls/" + active.call.id + "/end").catch(() => {
        });
        return;
      }
      modal2(end ? "结束会议" : "离开会议", '<p class="hint">' + (end ? "结束后所有成员将离开，会议号立即失效。" : "其他成员可继续交流；主持人离开后会自动转交权限。") + "</p>", '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-confirm-leave">确认</button>');
      const button = el("meeting-confirm-leave");
      button.onclick = async () => {
        if (room !== active) {
          closeModal2();
          return;
        }
        button.disabled = true;
        try {
          if (end) await action2("/api/meetings/" + active.code + "/end");
          if (room === active) {
            active.intentional = true;
            cleanup(active);
          }
          closeModal2();
        } catch (e) {
          if (button.isConnected) {
            el("modal-error").textContent = e.message;
            button.disabled = false;
          }
        }
      };
    }
    function cleanup(active) {
      var _a, _b;
      display.exit().catch(() => {
      });
      closeModal2();
      if (room === active) {
        stopRecording();
        room = null;
      }
      (_a = active.microphoneMeter) == null ? void 0 : _a.close();
      clearInterval(active.ping);
      clearInterval(active.callClock);
      active.ws.close();
      for (const p of active.peers.values()) {
        p.route.close();
        p.pc.close();
      }
      ;
      active.stream.getTracks().forEach((t) => t.stop());
      (_b = active.screen) == null ? void 0 : _b.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      root().innerHTML = "";
      root().classList.remove("meeting-minimized", "call-mode", "call-audio");
      if (active.call) onCallClosed(active.call.id);
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-action]"), a = b == null ? void 0 : b.dataset.action;
      switch (a) {
        case "meeting-create":
          openCreate();
          break;
        case "meeting-start":
          openCreate(S2.active);
          break;
        case "meeting-audio-call":
          openCreate(S2.active, "audio");
          break;
        case "meeting-join":
          openJoin();
          break;
        case "meeting-open":
          show();
          break;
      }
      const m = e.target.closest("[data-meeting-code]");
      if (m) openJoin(m.dataset.meetingCode);
    });
    function formatDuration(value) {
      const n = Math.max(0, Math.floor(value));
      return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
    }
    return { renderHome, openCreate, openJoin, invited, ended, nativeAction, show, busy: () => !!room || !!nativeCall, joinCall: (c) => join(c.code, true, c.mode === "video", c.caller === S2.user.id, c), closedNativeCall: (id) => {
      if (nativeCall === id) nativeCall = null;
    }, closeCall: (id) => {
      var _a, _b, _c;
      if (nativeCall === id) {
        (_b = (_a = window.WeLinkAndroid) == null ? void 0 : _a.closeCall) == null ? void 0 : _b.call(_a, id);
        nativeCall = null;
      }
      if (((_c = room == null ? void 0 : room.call) == null ? void 0 : _c.id) === id) {
        room.intentional = true;
        cleanup(room);
      }
    }, close: () => {
      clearInvitations();
      if (room) {
        room.intentional = true;
        cleanup(room);
      }
    } };
  }

  // internal/ui/src/app.js
  var randomID = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  var $ = (s, r = document) => r.querySelector(s);
  var $$ = (s, r = document) => [...r.querySelectorAll(s)];
  var esc = (v) => String(v != null ? v : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var paths = { cloud: "M7 18a5 5 0 1 1 .5-9.98A7 7 0 0 1 21 10a4 4 0 0 1-1 8ZM9 14l3-3 3 3M12 11v9", notebook: "M5 3h14v18H5ZM8 3v18M3 7h4M3 12h4M3 17h4M11 8h5M11 12h5", chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 2v-6.5A8.5 8.5 0 1 1 21 11.5ZM8 11h.01M12 11h.01M16 11h.01", contacts: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87", folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18", star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z", monitor: "M3 4h18v13H3ZM8 21h8M12 17v4", settings: "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0", search: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.5-2 5 5", plus: "M12 5v14M5 12h14", more: "M5 12h.01M12 12h.01M19 12h.01", close: "m6 6 12 12M18 6 6 18", minus: "M5 12h14", maximize: "M5 5h14v14H5Z", chevron: "m9 5 7 7-7 7", back: "m15 5-7 7 7 7", down: "m5 9 7 7 7-7", emoji: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 9h.01M16 9h.01M7 14c2 4 8 4 10 0", image: "M3 3h18v18H3ZM3 16l5-5 5 5 3-3 5 5M15 7h.01", file: "M14 2H5v20h14V7ZM14 2v6h5M8 13h8M8 17h6", scissors: "M6 14a4 4 0 1 1-4 4 4 4 0 0 1 4-4ZM6 2a4 4 0 1 1-4 4 4 4 0 0 1 4-4Zm3 7 12 12M9 15 21 3", history: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2", phone: "M4 3h4l2 5-3 2c1 3 4 6 7 7l2-3 5 2v4c-9 3-20-8-17-17Z", video: "M3 5h12v14H3ZM15 9l6-3v12l-6-3", reply: "m9 5-6 6 6 6M3 11h10c5 0 8 3 8 8", trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7", check: "m4 12 5 5L20 6", bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4", mute: "M9 5a6 6 0 0 1 9 5c0 3 1 5 3 7H8M3 3l18 18M6 8c0 6-3 7-3 9h3", pin: "m8 3 8 0-1 7 4 4H5l4-4ZM12 14v8", download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5", logout: "M9 4H4v16h5M9 12h12m-4-4 4 4-4 4", user: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 22v-2a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7v2", shield: "m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6ZM8 12l3 3 5-6", send: "m3 3 19 9-19 9 4-9ZM7 12h15", copy: "M8 8h13v13H8ZM16 8V3H3v13h5", refresh: "M3 11a9 9 0 0 1 15-7l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 7l-3-3M3 21v-5h5", info: "M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" };
  var icon = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'.concat(paths[n] || paths.chat, '"/></svg>');
  var btn = (name, title, action2, extra = "") => '<button class="icon-btn" title="'.concat(title, '" aria-label="').concat(title, '" data-action="').concat(action2, '" ').concat(extra, ">").concat(icon(name), "</button>");
  var av = (u = {}, size = "", online = false) => {
    if (u.ai || u.avatar === "bot:me") return '<span class="avatar me-avatar ' + size + '" data-avatar-user="' + esc(u.id) + '">M</span>';
    const cartoon = cartoonURL(u.avatar), photo = /^image:[a-f0-9]{32}$/.test(u.avatar || "");
    return '<span class="avatar '.concat(photo || cartoon ? "has-photo" : esc(u.avatar || "blue"), " ").concat(size, '" ').concat(u.kind !== "group" && (u.sender || u.id) ? 'data-avatar-user="' + esc(u.sender || u.id) + '"' : "", ">").concat(u.kind === "group" ? icon("contacts") : esc((u.name || "M").slice(0, 1))).concat(photo || cartoon ? '<img class="avatar-photo" src="' + (cartoon || "/api/avatars/" + u.avatar.slice(6)) + '" alt="">' : "").concat(online && u.online ? '<i class="dot"></i>' : "", "</span>");
  };
  var logo = () => '<div class="logo"><img src="/assets/icon.svg" alt=""><b>LinkMe</b></div>';
  var S = { token: localStorage.getItem("welink_token") || "", user: null, config: {}, policy: {}, registrationEnabled: false, tab: "messages", contactTab: "friends", conversations: [], friends: [], requests: [], groupRequests: [], contactGroups: [], myGroups: [], messages: [], active: null, profile: null, search: "", historyMode: false, reply: null, drafts: {}, ws: null, offline: false, cacheView: false, cacheSyncing: false, remote: null, remoteTimer: null, remoteLocal: null };
  var modalHandler = null;
  var refreshTimer = null;
  var toastTimer;
  var searchTimer;
  var typingAt = 0;
  function toast(msg) {
    const n = document.createElement("div");
    n.className = "toast";
    n.textContent = msg;
    $("#toasts").innerHTML = "";
    $("#toasts").appendChild(n);
    setTimeout(() => n.remove(), 3800);
  }
  async function api(path, options = {}) {
    const token = S.token, server = S.config.server;
    const value = await Received.run(path, options, () => {
      if (!path.startsWith("/local") && (token !== S.token || server !== S.config.server)) throw Object.assign(Error("登录账号已变化"), { name: "AbortError" });
      return apiNetwork(path, options, token);
    });
    if (!path.startsWith("/local") && (token !== S.token || server !== S.config.server)) throw Object.assign(Error("登录账号已变化"), { name: "AbortError" });
    return value;
  }
  async function apiNetwork(path, options = {}, requestToken = S.token) {
    const headers = __spreadValues({}, options.headers);
    if (requestToken) headers.Authorization = "Bearer " + requestToken;
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    ;
    const r = await fetch(path, __spreadProps(__spreadValues({}, options), { headers }));
    if (requestToken !== S.token && !path.startsWith("/local")) throw Object.assign(Error("登录账号已变化"), { name: "AbortError" });
    if (r.status === 401 && S.user && requestToken === S.token && !path.startsWith("/local")) {
      logout(false);
      throw Object.assign(Error("登录已过期，请重新登录"), { status: 401 });
    }
    ;
    if (!r.ok) {
      let p;
      try {
        p = await r.json();
      } catch (e) {
      }
      throw Object.assign(Error((p == null ? void 0 : p.error) || "请求失败 (".concat(r.status, ")")), { status: r.status });
    }
    ;
    return r.status === 204 ? null : r.json();
  }
  var action = (p, body = {}) => api(p, { method: "POST", body });
  function shortTime(value) {
    const d = new Date(value), today = /* @__PURE__ */ new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const yesterday = new Date(Date.now() - 864e5);
    if (d.toDateString() === yesterday.toDateString()) return "昨天";
    return "".concat(d.getMonth() + 1, "/").concat(d.getDate());
  }
  function fullTime(t) {
    return new Date(t).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function preview(m) {
    if (!m) return "开始聊天";
    if (m.kind === "call" && !m.recalled) return Calls.summary(m);
    if (m.kind === "forward" && !m.recalled) {
      try {
        return "[聊天记录] " + JSON.parse(m.text).title;
      } catch (e) {
        return "[聊天记录]";
      }
    }
    if (m.kind === "meeting" && !m.recalled) {
      try {
        return "[会议] " + JSON.parse(m.text).title;
      } catch (e) {
        return "[会议]";
      }
    }
    return m.recalled ? "消息已撤回" : m.kind === "voice" ? "[语音]" : m.kind === "video" ? "[视频]" : m.kind === "image" ? "[图片]" : m.kind === "file" ? "[文件] ".concat(m.fileName) : m.text;
  }
  function modal(...args) {
    Navigation.open(...args);
  }
  var modalError = (e) => {
    $("#modal-error") ? $("#modal-error").textContent = e.message : toast(e.message);
  };
  function closeModal() {
    Navigation.clear();
  }
  function finishModal() {
    Navigation.complete();
  }
  var pageHistory = [];
  var NativeNotifications = createNativeNotifications({ S, action, selectConversation, refresh, toast });
  function pageBack() {
    var _a;
    if ($(".remote-screen")) {
      (_a = $(".remote-screen [data-action=stop-remote]")) == null ? void 0 : _a.click();
      return true;
    }
    if (S.tab === "drive" && Cloud.back()) return true;
    if (S.profile && S.tab === "contacts") {
      S.profile = null;
      renderShell();
      return true;
    }
    if (S.active && S.tab === "messages") {
      Media.reset();
      Forwarding.reset(false);
      S.active = null;
      S.messages = [];
      S.reply = null;
      renderShell();
      return true;
    }
    const previous = pageHistory.pop();
    if (previous) {
      Object.assign(S, previous.state);
      renderShell();
      if (previous.settings) settings();
      return true;
    }
    if (S.user && S.tab !== "messages") {
      S.tab = "messages";
      S.search = "";
      S.profile = null;
      renderShell();
      return true;
    }
    return false;
  }
  function navigatePage(button) {
    var _a;
    const tab = button.dataset.nav;
    if (!["messages", "contacts", "meetings", "drive", "files", "favorites", "profile", "admin"].includes(tab)) return;
    if (!button.closest(".rail") && tab !== S.tab) pageHistory.push({ state: { tab: S.tab, active: S.active, profile: S.profile, search: S.search }, settings: ((_a = $(".modal")) == null ? void 0 : _a.getAttribute("aria-label")) === "设置" });
    else pageHistory.length = 0;
    closeModal();
    S.tab = tab;
    S.search = "";
    S.profile = null;
    renderShell();
  }
  function pageNavigation() {
    var _a;
    return '<header class="utility-navigation"><button class="page-back" data-action="page-back">' + icon("back") + "返回" + (((_a = pageHistory[pageHistory.length - 1]) == null ? void 0 : _a.settings) ? "设置" : "") + "</button></header>";
  }
  var Navigation = createNavigation({ getHandler: () => modalHandler, setHandler: (value) => {
    modalHandler = value;
  }, beforeOpen: () => {
    var _a;
    return (_a = window.WeLinkMediaBeforeModal) == null ? void 0 : _a.call(window);
  }, esc, icon, onPageBack: () => RemoteDisplay.back() || pageBack(), beforeBack: () => {
    var _a, _b;
    if (((_a = S.remote) == null ? void 0 : _a.state) !== "pending" || !$(".remote-invite")) return false;
    (S.remote.requester === ((_b = S.user) == null ? void 0 : _b.id) ? stopRemote() : acceptRemote(false)).catch(modalError);
    return true;
  } });
  function windows() {
    return S.config.platform === "windows" ? '<div class="window-controls">'.concat(btn("minus", "最小化", "window-min")).concat(btn("maximize", "最大化", "window-max")).concat(btn("close", "关闭", "window-close"), "</div>") : "";
  }
  function renderAuth(register = false) {
    return EmailAuth.render(register ? "register" : "login");
  }
  function nav() {
    const unread = S.conversations.reduce((n, c) => n + (c.muted ? c.mentionCount || 0 : c.unread), 0), requests = S.requests.filter((q) => q.recipient === S.user.id && q.status === "pending").length + S.groupRequests.filter((q) => q.canReview && q.status === "pending").length;
    return '<aside class="rail"><button class="self" title="个人资料" data-action="profile">'.concat(av(S.user, "", true), "</button><nav>").concat([["messages", "chat", "消息", unread], ["contacts", "contacts", "联系人", requests], ["meetings", "video", "会议", 0], ["drive", "cloud", "网盘", 0], ["files", "folder", "文件", 0], ["favorites", "star", "收藏", 0], ["profile", "user", "我的", 0]].map(([tab, i, t, n]) => '<button data-nav="'.concat(tab, '" class="').concat(S.tab === tab ? "active" : "", '" title="').concat(t, '" aria-label="').concat(t, '">').concat(icon(i), '<span class="rail-label">').concat(t, "</span>").concat(n ? '<span class="badge">'.concat(n > 99 ? "99+" : n, "</span>") : "", "</button>")).join(""), '</nav><div class="rail-bottom">').concat(btn("settings", "设置", "settings")).concat(btn("more", "更多", "more-menu"), "</div></aside>");
  }
  function renderShell() {
    const utility = !["messages", "contacts"].includes(S.tab);
    $("#app").innerHTML = '<div class="shell '.concat(S.active && S.tab === "messages" ? "in-chat" : "", " ").concat(utility ? "in-utility" : "", '">').concat(nav(), '<aside class="sidebar"><div class="mobile-title"><button data-action="profile">').concat(av(S.user), "</button><h2>").concat(S.tab === "contacts" ? "联系人" : "消息", "</h2>").concat(btn("plus", "创建群聊或扫一扫", "add-menu"), '</div><div class="searchbar"><label class="searchbox">').concat(icon("search"), '<input id="sidebar-search" value="').concat(esc(S.search), '" placeholder="搜索用户或群聊" aria-label="搜索用户或群聊" maxlength="60"></label>').concat(btn("plus", "创建群聊或扫一扫", "add-menu"), '</div><div class="sidebar-connection-status"></div><div id="sidebar-content" class="list-scroll"></div></aside><main class="main">').concat(windows(), '<div id="connection-status"></div>').concat(utility ? pageNavigation() : "", '<div id="main-content" style="display:contents"></div></main></div>');
    renderSidebar();
    renderMain();
    $("#sidebar-search").oninput = (e) => {
      S.search = e.target.value;
      renderSidebar();
    };
    connectionState();
  }
  function renderSidebar() {
    const list = $("#sidebar-content");
    if (!list) return;
    const q = S.search.toLowerCase();
    if (q.trim()) {
      list.innerHTML = Directory.render(S.search);
      return;
    }
    if (S.tab === "contacts") {
      list.innerHTML = '<button class="notify-row group-notice-row" data-group="requests">' + icon("contacts") + '群通知</button><div class="contact-tab"><button data-contact-tab="friends" class="' + (S.contactTab === "friends" ? "active" : "") + '">联系人</button><button data-contact-tab="groups" class="' + (S.contactTab === "groups" ? "active" : "") + '">群聊</button></div>' + (S.contactTab === "friends" ? Contacts.sidebar() : S.myGroups.map((g) => S.conversations.find((c) => c.id === g.id) || { id: g.id, kind: "group", name: g.name, avatar: g.avatar, group: g, unread: 0 }).map(conversationRow).join("") || '<div class="empty-list">还没有群聊</div>');
      return;
    }
    const result = S.conversations.filter((c) => {
      var _a, _b, _c;
      return (c.name + (((_a = c.peer) == null ? void 0 : _a.number) || "") + (((_b = c.group) == null ? void 0 : _b.number) || "") + (((_c = c.last) == null ? void 0 : _c.text) || "")).toLowerCase().includes(q);
    });
    const users = q ? S.friends.filter((u) => (u.name + (u.remark || "") + u.number + u.id + u.account).toLowerCase().includes(q)) : [];
    list.innerHTML = Me.sidebar() + result.map(conversationRow).join("") + (users.length ? '<div class="search-section-label">搜索用户 · 直接聊天</div>' + users.map((u) => '<div class="user-search-result"><button class="conversation-row" data-start-chat="' + u.id + '">' + av(u, "", true) + '<div class="row-text"><div class="row-title"><b>' + esc(u.remark || u.name) + '</b></div><div class="row-preview">' + esc(u.number) + '</div></div></button><div class="user-search-actions"><button data-start-chat="' + u.id + '">发消息</button><button data-user-call="' + u.id + '" data-user-call-mode="audio" title="语音通话" aria-label="语音通话">' + icon("phone") + '</button><button data-user-call="' + u.id + '" data-user-call-mode="video" title="视频通话" aria-label="视频通话">' + icon("video") + "</button></div></div>").join("") : "") + (!result.length && !users.length ? '<div class="empty-list">' + (q ? "没有找到相关用户或会话" : "暂无消息<br>搜索用户，直接开始聊天") + "</div>" : "");
  }
  function conversationRow(c) {
    var _a;
    return '<div class="conversation-item"><button class="conversation-row '.concat(S.active === c.id ? "selected" : "", " ").concat(c.pinned ? "pinned" : "", '" data-conversation="').concat(c.id, '">').concat(av(c.kind === "group" ? { name: c.name, kind: "group", avatar: c.avatar || "group" } : c.peer || c), '<div class="row-text"><div class="row-title"><b>').concat(esc(c.name), "</b>").concat(((_a = c.peer) == null ? void 0 : _a.ai) ? '<em class="ai-label">AI</em>' : "").concat(c.kind === "direct" ? Contacts.badge(c.peer) : "", "<time>").concat(c.last ? shortTime(c.last.created) : "", '</time></div><div class="row-preview"><span>').concat(c.mentionCount ? '<i class="mention-unread">[有人@我]</i>' : "").concat(esc(c.kind === "group" && c.last && !c.last.recalled ? "".concat(c.last.name, "：") : "")).concat(esc(preview(c.last)), "</span>").concat(c.muted ? icon("mute") : "").concat(c.unread ? '<i class="badge">'.concat(c.unread > 99 ? "99+" : c.unread, "</i>") : "", '</div></div></button><button type="button" class="conversation-more" data-conversation-menu="').concat(c.id, '" aria-label="').concat(esc(c.name), '的会话操作" title="会话操作">').concat(icon("more"), "</button></div>");
  }
  function activeConversation() {
    return S.conversations.find((c) => c.id === S.active);
  }
  function renderMain() {
    var _a, _b, _c, _d;
    const main = $("#main-content");
    if (!main) return;
    if (S.tab === "drive") {
      Cloud.renderDrive().catch((e) => toast(e.message));
      return;
    }
    if (S.tab === "admin") {
      Admin.render().catch((e) => toast(e.message));
      return;
    }
    if (S.tab === "contacts") {
      if (S.profile) {
        renderContactProfile();
        return;
      }
      ;
      main.innerHTML = empty("联系人", "找到好友，让联系更简单");
      return;
    }
    ;
    if (S.tab === "files") {
      renderFiles();
      return;
    }
    ;
    if (S.tab === "favorites") {
      renderFavorites();
      return;
    }
    ;
    if (S.tab === "meetings") {
      Meetings.renderHome();
      return;
    }
    ;
    if (S.tab === "profile") {
      renderMyPage();
      return;
    }
    ;
    const c = activeConversation();
    if (!c) {
      main.innerHTML = empty("LinkMe", "每一句，都有回应。", true);
      return;
    }
    ;
    main.innerHTML = '<header class="chat-head">'.concat(btn("back", "返回", "back", "").replace('class="icon-btn"', 'class="icon-btn mobile-back"'), "<h2>").concat(esc(c.name), '<small id="typing-status">').concat(c.kind === "direct" ? ((_a = c.peer) == null ? void 0 : _a.online) ? "在线" : "离线" : "群聊", '</small></h2><div class="chat-actions">').concat(((_b = c.peer) == null ? void 0 : _b.ai) ? "" : c.kind === "direct" ? '<button class="icon-btn" title="语音通话" aria-label="语音通话" data-call-mode="audio">' + icon("phone") + '</button><button class="icon-btn" title="视频通话" aria-label="视频通话" data-call-mode="video">' + icon("video") + "</button>" : btn("phone", "语音通话", "meeting-audio-call") + btn("video", "发起会议", "meeting-start")).concat(c.kind === "direct" && !((_c = c.peer) == null ? void 0 : _c.ai) ? btn("monitor", "远程协助", "remote") : "").concat(btn("search", "搜索聊天记录", "search-history")).concat(btn("more", "聊天设置", "chat-detail"), '</div></header><div id="sharing-banner"></div><div id="me-panel" class="hidden"></div><div id="mention-jump"></div><section class="message-area" id="messages" aria-label="聊天记录"></section><section class="composer" aria-label="消息输入"><div class="reply-draft hidden" id="reply-draft"></div><div class="compose-tools">').concat(Media.tools()).concat(Mentions.tool()).concat(btn("emoji", "表情", "emoji")).concat(btn("image", "发送图片", "image"), '<button class="icon-btn" title="发送视频" aria-label="发送视频" data-media="video">').concat(icon("video"), "</button>").concat(btn("folder", "发送文件", "file")).concat(btn("scissors", "截图", "screenshot"), '<span class="spacer"></span></div><textarea id="composer" placeholder="" aria-label="输入消息" maxlength="6000">').concat(esc(S.drafts[c.id] || ""), "</textarea>").concat(Media.input(), '<div class="compose-bottom"><small>Enter 发送，Shift + Enter 换行</small><button class="send-btn" id="send-message" data-action="send" ').concat(((_d = S.drafts[c.id]) == null ? void 0 : _d.trim()) ? "" : "disabled", '>发送</button></div><input type="file" id="image-input" class="file-input" accept="image/png,image/jpeg,image/gif,image/webp"><input type="file" id="file-input" class="file-input"></section>');
    renderMessages();
    const input = $("#composer");
    input.oninput = () => {
      var _a2;
      Mentions.changed();
      S.drafts[S.active] = input.value;
      Outbox.saveDraft().catch(() => {
      });
      $("#send-message").disabled = !input.value.trim();
      if (Date.now() - typingAt > 2500 && ((_a2 = S.ws) == null ? void 0 : _a2.readyState) === 1) {
        typingAt = Date.now();
        S.ws.send(JSON.stringify({ type: "typing", conversationId: S.active }));
      }
    };
    input.onkeydown = (e) => {
      if (Mentions.key(e)) return;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    };
    input.onpaste = (e) => {
      var _a2;
      const f = [...((_a2 = e.clipboardData) == null ? void 0 : _a2.files) || []][0];
      if (f) {
        e.preventDefault();
        upload(f);
      }
    };
    $("#image-input").onchange = (e) => {
      if (e.target.files[0]) upload(e.target.files[0]);
      e.target.value = "";
    };
    $("#file-input").onchange = (e) => {
      if (e.target.files[0]) upload(e.target.files[0]);
      e.target.value = "";
    };
    const area = $("#messages");
    renderReply();
    renderSharing();
    Media.mount();
    Groups.syncComposer();
    Contacts.syncComposer();
    Mentions.mount();
    Me.mount();
  }
  function empty(title, sub, add = false) {
    return '<div class="empty-chat"><img src="/assets/icon.svg" alt=""><h2>'.concat(title, "</h2><p>").concat(sub, "</p></div>");
  }
  function fileURL(id) {
    return "/api/files/" + encodeURIComponent(id);
  }
  function messageHTML(m) {
    var _a;
    if (m.recalled) return '<div class="recalled" data-message="'.concat(m.id, '">').concat(Forwarding.checkbox(m)).concat(m.sender === S.user.id ? "你" : esc(m.name), "撤回了一条消息</div>");
    const mine = m.sender === S.user.id;
    const quote = S.messages.find((x) => x.id === m.replyId) || m.reply;
    let content = Mentions.text(m);
    if (m.kind === "call") content = Calls.card(m);
    if (m.kind === "voice" || m.kind === "video") content = Media.bubble(m);
    if (m.kind === "forward") content = Forwarding.card(m);
    if (m.kind === "meeting") {
      try {
        const meeting = JSON.parse(m.text);
        content = '<button class="file-card" data-meeting-code="'.concat(esc(meeting.code), '">').concat(icon("video"), "<span><b>").concat(esc(meeting.title), "</b><small>会议号 ").concat(esc(meeting.code), " · 点击加入</small></span></button>");
      } catch (e) {
      }
    }
    if (m.kind === "image") content = S.offline ? '<div class="file-card">' + icon("image") + "<span><b>" + esc(m.fileName || "图片") + "</b><small>联网后查看图片</small></span></div>" : '<img src="'.concat(fileURL(m.attachmentId), '" alt="').concat(esc(m.fileName || "图片"), '" loading="lazy" data-preview-image="').concat(m.attachmentId, '">');
    if (m.kind === "file") content = '<button class="file-card" data-download="'.concat(m.attachmentId, '" data-filename="').concat(esc(m.fileName), '">').concat(icon("file"), "<span><b>").concat(esc(m.fileName), "</b><small>").concat(bytes(m.fileSize), " · 点击下载</small></span></button>");
    return '<article class="message '.concat(mine ? "mine" : "", '" data-message="').concat(m.id, '">').concat(Forwarding.checkbox(m)).concat(av(m), '<div class="message-body"><span class="message-name">').concat(esc(m.name || (mine ? S.user.name : (_a = activeConversation()) == null ? void 0 : _a.name) || "LinkMe 用户"), '</span><div class="bubble ').concat(m.kind === "image" ? "image-bubble" : m.kind === "forward" ? "forward-bubble" : m.kind === "voice" ? "voice-bubble" : m.kind === "video" ? "video-bubble" : "", '">').concat(content, "</div>").concat(m.replyId ? '<button class="quote" data-action="jump-message" data-mid="'.concat(m.replyId, '" title="查看原消息">').concat(quote ? esc(quote.name + "：" + preview(quote)) : "原消息不可用", "</button>") : "", '<span class="message-time">').concat(shortTime(m.created), '</span></div><div class="message-menu"><button class="icon-btn" title="转发" aria-label="转发" data-fw="single" data-mid="').concat(m.id, '">').concat(icon("send"), "</button>").concat(btn("reply", "引用", "quote", 'data-mid="'.concat(m.id, '"'))).concat(btn("star", "收藏", "favorite", 'data-mid="'.concat(m.id, '"'))).concat(mine && Date.now() - m.created < 12e4 ? btn("history", "撤回", "recall", 'data-mid="'.concat(m.id, '"')) : "").concat(btn("trash", "删除", "delete-message", 'data-mid="'.concat(m.id, '"')), "</div></article>");
  }
  function renderMessages(keep = false) {
    const area = $("#messages");
    if (!area) return;
    const old = area.scrollTop, near = area.scrollHeight - area.clientHeight - old < 100;
    let last = 0;
    area.innerHTML = (S.messages.length >= 60 ? '<button class="load-more" data-action="load-older">查看更多消息</button>' : "") + S.messages.map((m) => {
      let date = "";
      if (m.created - last > 3e5) {
        last = m.created;
        date = '<div class="timestamp">'.concat(fullTime(m.created), "</div>");
      }
      return date + messageHTML(m);
    }).join("");
    if (S.historyMode) area.insertAdjacentHTML("beforeend", '<div class="history-live-bar"><button data-action="load-newer">查看后续消息</button><button data-action="latest-messages">返回最新消息</button></div>');
    const pending = Outbox.html(S.active) + Transfers.html(S.active);
    if (!S.messages.length && !pending) area.innerHTML = '<div class="timestamp">' + (S.offline ? "此会话尚无本机缓存，联网后加载消息" : "和好友打个招呼吧") + "</div>";
    area.insertAdjacentHTML("beforeend", pending);
    Forwarding.sync();
    Media.sync();
    if (!keep || near) area.scrollTop = area.scrollHeight;
    else area.scrollTop = old;
    $$("img", area).forEach((img) => img.onload = () => {
      if (!keep || near) area.scrollTop = area.scrollHeight;
    });
  }
  async function selectConversation(id) {
    var _a;
    if (!S.conversations.some((c) => c.id === id)) {
      await action("/api/conversations/" + id + "/open");
      await refresh();
      if (!S.conversations.some((c) => c.id === id)) return;
    }
    Mentions.select(id);
    Media.reset();
    Forwarding.reset(false);
    S.active = id;
    S.historyMode = false;
    S.tab = "messages";
    S.reply = Outbox.replyPlaceholder(id);
    S.messages = [];
    S.profile = null;
    S.search = "";
    renderShell();
    try {
      const m = await api("/api/conversations/".concat(id, "/messages"));
      if (S.active !== id) return;
      S.messages = m;
      renderMessages();
      await Outbox.restoreReply(id);
      await markRead();
      if (innerWidth > 700) (_a = $("#composer")) == null ? void 0 : _a.focus();
    } catch (e) {
      toast(e.message);
    }
  }
  async function markRead() {
    if (S.offline || S.cacheSyncing) return;
    const last = S.messages[S.messages.length - 1];
    if (!last || Desktop.hidden() || S.historyMode || S.tab !== "messages" || !$("#messages")) return;
    await action("/api/conversations/".concat(S.active, "/read"), { seq: last.seq });
    const c = activeConversation();
    if (c) {
      c.unread = 0;
      c.mentionCount = 0;
      c.firstMentionId = "";
    }
    renderSidebar();
    updateRail();
  }
  function updateRail() {
    const old = $(".rail");
    if (old) old.outerHTML = nav();
    Desktop.unread();
  }
  async function sendMessage() {
    var _a;
    if (Me.busy()) {
      toast("Me 正在处理，请等待完成或停止任务");
      return;
    }
    const input = $("#composer");
    if (!(input == null ? void 0 : input.value.trim()) || input.disabled) return;
    const text = input.value, cid = S.active, owner2 = Outbox.scope();
    input.disabled = true;
    try {
      await Outbox.enqueue(cid, { kind: "text", text, mentions: Mentions.payload(), replyId: ((_a = S.reply) == null ? void 0 : _a.id) || "" }, null, {}, true);
      if (Outbox.scope() !== owner2) return;
      if (S.active === cid && input === $("#composer")) {
        input.value = "";
        $("#send-message").disabled = true;
        S.reply = null;
        renderReply();
        renderMessages();
      }
    } catch (e) {
      Mentions.failed();
      toast(e.message);
    } finally {
      if (input.isConnected) {
        input.disabled = false;
        input.focus();
        Groups.syncComposer();
        Contacts.syncComposer();
      }
    }
  }
  function renderReply() {
    const d = $("#reply-draft");
    if (!d) return;
    d.classList.toggle("hidden", !S.reply);
    d.closest(".composer").classList.toggle("has-reply", !!S.reply);
    d.innerHTML = S.reply ? "<span>回复 ".concat(esc(S.reply.name), "：").concat(esc(preview(S.reply)), "</span>").concat(btn("close", "取消引用", "cancel-reply")) : "";
  }
  async function upload(file, forceFile = false, cid = S.active) {
    if (cid === S.active && !forceFile && (/^video\//.test(file.type) || /\.(mp4|webm|m4v)$/i.test(file.name))) {
      await Media.sendVideo(file);
      return;
    }
    if (!cid) return;
    try {
      await Outbox.enqueue(cid, { kind: forceFile ? "file" : "auto", text: "" }, file);
    } catch (e) {
      toast(e.message);
    }
  }
  function bytes(n) {
    return n >= 1099511627776 ? (n / 1099511627776).toFixed(1) + " TB" : n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.ceil(n / 1024) + " KB" : n + " B";
  }
  async function refresh(conversationsOnly = false) {
    var _a, _b;
    if (!S.user) return;
    const userId = S.user.id;
    const [conversations, friends, requests, groupRequests, contactGroups, myGroups] = await Promise.all([api("/api/conversations"), conversationsOnly ? S.friends : api("/api/friends"), conversationsOnly ? S.requests : api("/api/requests"), conversationsOnly ? S.groupRequests : api("/api/group-requests"), conversationsOnly ? S.contactGroups : api("/api/contact-groups"), conversationsOnly ? S.myGroups : api("/api/groups?mine=1").catch(() => null)]);
    if (((_a = S.user) == null ? void 0 : _a.id) !== userId) return;
    S.conversations = conversations;
    if (!conversationsOnly) {
      S.friends = friends;
      S.requests = requests;
      S.groupRequests = groupRequests;
      S.contactGroups = contactGroups;
      S.myGroups = myGroups || conversations.filter((c2) => c2.kind === "group").map((c2) => __spreadProps(__spreadValues({ id: c2.id, name: c2.name }, c2.group), { joined: true }));
      Directory.changed();
    }
    if (!conversationsOnly && S.profile) {
      const updated = friends.find((u) => u.id === S.profile.id);
      S.profile = updated ? __spreadValues(__spreadValues({}, S.profile), updated) : null;
      if (S.tab === "contacts") renderMain();
    }
    if (S.active && !conversations.some((c2) => c2.id === S.active)) {
      Media.reset();
      Forwarding.reset(false);
      S.active = null;
      S.messages = [];
      S.reply = null;
      closeModal();
      renderShell();
    }
    renderSidebar();
    updateRail();
    const c = activeConversation();
    if (c && $("#typing-status")) $("#typing-status").textContent = c.kind === "direct" ? ((_b = c.peer) == null ? void 0 : _b.online) ? "在线" : "离线" : "群聊";
    Groups.syncComposer();
    Contacts.syncComposer();
  }
  var refreshDirectory = false;
  function queueRefresh(conversationsOnly = false) {
    refreshDirectory = refreshDirectory || !conversationsOnly;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const only = !refreshDirectory;
      refreshDirectory = false;
      refresh(only).catch((e) => {
        if (S.user) toast(e.message);
      });
    }, 200);
  }
  async function enter() {
    await Sounds.ready;
    if (!S.cacheView) await Received.identified(S.user);
    await Promise.all([api("/api/config").then((policy) => {
      S.policy = policy;
    }), refresh()]);
    await Outbox.start();
    renderShell();
    Me.start().catch(() => {
    });
    await NativeNotifications.start().catch(() => toast("消息通知连接暂不可用，正在重试"));
    connectEvents(true);
    Calls.start();
    NativeNotifications.drainInvites();
  }
  function connectEvents(initial = false) {
    var _a;
    if (!S.user) return;
    (_a = S.ws) == null ? void 0 : _a.close();
    const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/ws");
    S.ws = ws;
    ws.onopen = async () => {
      if (S.ws !== ws || !S.user) return;
      const directoryFresh = initial && !S.cacheView && !S.offline;
      S.cacheView = false;
      S.cacheSyncing = true;
      connectionState();
      try {
        await Received.reconcile(api);
        if (S.ws !== ws || !S.user) return;
        await refresh(directoryFresh);
        if (S.active && !S.historyMode) {
          const cid = S.active, ms = await api("/api/conversations/" + cid + "/messages");
          if (S.ws !== ws || !S.user) return;
          if (S.active === cid && !S.historyMode) {
            S.messages = ms;
            renderMessages(true);
          }
        }
        if (S.ws === ws && !S.cacheView) {
          S.offline = false;
          Outbox.kick();
        }
      } catch (e) {
      } finally {
        if (S.ws === ws) {
          S.cacheSyncing = false;
          connectionState();
          markRead().catch(() => {
          });
        }
      }
    };
    ws.onmessage = (e) => {
      var _a2, _b, _c;
      if (S.ws !== ws || !S.user || S.signingOut) return;
      let event;
      try {
        event = JSON.parse(e.data);
      } catch (e2) {
        return;
      }
      const d = event.data;
      if (event.type === "ai-delta" || event.type === "ai-state") {
        Me.changed(event.type, d);
      } else if (event.type === "call") {
        Calls.changed(d);
      } else if (event.type === "drive") {
        Cloud.changed(event.type);
      } else if (event.type === "call-history") {
        Calls.historyChanged();
      } else if (event.type === "message") {
        Received.event("message", d).catch(() => {
        });
        Outbox.ack(d).catch(() => {
        });
        if (S.active === d.conversationId && !S.historyMode) {
          if (!S.messages.some((m) => m.id === d.id)) S.messages.push(d);
          renderMessages(true);
          markRead().catch(() => {
          });
        }
        if ((S.active !== d.conversationId || S.tab !== "messages" || Desktop.hidden()) && d.sender !== S.user.id && (!((_a2 = S.conversations.find((c) => c.id === d.conversationId)) == null ? void 0 : _a2.muted) || Mentions.applies(d))) {
          if (!NativeNotifications.active()) Sounds.notify();
          if (!NativeNotifications.active() && !Desktop.native && document.hidden && ((_b = window.Notification) == null ? void 0 : _b.permission) === "granted") new Notification(((_c = S.friends.find((u) => u.id === d.sender)) == null ? void 0 : _c.remark) || d.name, { body: (Mentions.applies(d) ? "有人 @你：" : "") + preview(d), icon: "/assets/icon.svg", silent: true });
          document.title = Mentions.applies(d) ? "有人 @你 · LinkMe" : "新消息 · LinkMe";
        }
        queueRefresh(true);
      } else if (event.type === "read") {
        queueRefresh(true);
      } else if (event.type === "profile") {
        Avatars.changed(d);
        queueRefresh();
      } else if (event.type === "recall") {
        applyRecall(d);
      } else if (event.type === "message-deleted") {
        applyDeletion(d);
      } else if (event.type === "typing") {
        if (d.conversationId === S.active && d.userId !== S.user.id && $("#typing-status")) {
          $("#typing-status").textContent = "对方正在输入…";
          setTimeout(() => {
            var _a3, _b2;
            if ($("#typing-status")) $("#typing-status").textContent = ((_b2 = (_a3 = activeConversation()) == null ? void 0 : _a3.peer) == null ? void 0 : _b2.online) ? "在线" : "";
          }, 3200);
        }
      } else if (event.type === "meeting-invite") {
        Meetings.invited(d);
      } else if (event.type === "meeting-ended") {
        Meetings.ended(d);
      } else if (event.type === "remote") {
        remoteEvent(d);
      } else {
        queueRefresh();
      }
    };
    ws.onclose = (e) => {
      if (S.ws !== ws || !S.user || S.signingOut) return;
      if (e.code === 4001) {
        logout(false);
        toast("此设备已退出登录，请重新登录");
        return;
      }
      S.offline = true;
      connectionState();
      setTimeout(async () => {
        if (S.user && S.ws === ws) {
          try {
            await api("/api/me");
          } catch (e2) {
          }
          if (S.user && S.ws === ws) connectEvents();
        }
      }, 2500);
    };
  }
  function connectionState() {
    if (S.user && S.tab === "contacts") renderSidebar();
    const text = S.cacheSyncing ? "正在核对本机聊天记录…" : S.cacheView ? "离线查看 · 仅显示本机已缓存的记录" : S.offline ? "网络连接已断开，正在重新连接…" : "";
    for (const n of [$("#connection-status"), $(".sidebar-connection-status")]) if (n) n.innerHTML = text ? '<div class="connection-state" role="status">' + text + "</div>" : "";
  }
  async function logout(notify = true) {
    if (S.signingOut) return;
    const signingOutToken = S.token;
    pageHistory.length = 0;
    Sounds.reset();
    Screenshots.reset();
    Media.reset();
    Forwarding.reset(false);
    S.signingOut = true;
    Calls.stop();
    Me.stop();
    Outbox.stop();
    Transfers.stop();
    Cloud.reset();
    Admin.reset();
    Avatars.reset();
    Mentions.reset();
    S.drafts = {};
    try {
      await NativeNotifications.stop().catch(() => {
      });
      Meetings.close();
      await Received.forget();
      if (notify) try {
        await action("/api/auth/logout");
      } catch (e) {
      }
      S.user = null;
      const ws = S.ws;
      S.ws = null;
      ws == null ? void 0 : ws.close();
      S.token = "";
      if (localStorage.getItem("welink_token") === signingOutToken) localStorage.removeItem("welink_token");
      S.active = null;
      S.messages = [];
      S.conversations = [];
      S.myGroups = [];
      Directory.reset();
      S.friends = [];
      S.offline = false;
      S.cacheView = false;
      S.cacheSyncing = false;
      closeModal();
      stopRemote(false).catch(() => {
      });
      renderAuth();
    } finally {
      S.signingOut = false;
    }
  }
  function addFriend() {
    modal("查找用户", '<label for="find-user">LinkMe 号码 / 姓名</label><input id="find-user" placeholder="输入 LinkMe 号码或姓名" autocomplete="off"><div id="user-results" class="member-select"><p class="hint">输入至少两个字符，找到想联系的人。</p></div>');
    $("#find-user").oninput = (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value;
      searchTimer = setTimeout(async () => {
        try {
          const users = await api("/api/users?q=" + encodeURIComponent(q));
          const list = $("#user-results");
          if (!list) return;
          list.innerHTML = users.map((u) => '<div class="utility-row">'.concat(av(u), '<div class="body"><b>').concat(esc(u.name), "</b><p>").concat(esc(u.number || u.account), '</p></div><button class="secondary" data-start-chat="').concat(u.id, '">发消息</button><button class="icon-btn" data-user-call="').concat(u.id, '" data-user-call-mode="audio" title="语音通话">').concat(icon("phone"), '</button><button class="icon-btn" data-user-call="').concat(u.id, '" data-user-call-mode="video" title="视频通话">').concat(icon("video"), "</button></div>")).join("") || '<div class="empty-list">未找到用户</div>';
        } catch (e2) {
          modalError(e2);
        }
      }, 250);
    };
  }
  function requestFriend(id, name) {
    modal("添加 " + name, '<label for="request-message">验证消息</label><input id="request-message" maxlength="150" value="你好，我是 ' + esc(S.user.name) + '">', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">发送申请</button>');
    modalHandler = async () => {
      await action("/api/requests", { userId: id, message: $("#request-message").value });
      closeModal();
      toast("好友申请已发送");
      await refresh();
    };
  }
  function createGroup() {
    modal("创建群聊", '<label for="group-name">群名称（选填）</label><input id="group-name" maxlength="60" placeholder="默认用你和第一位成员的名字命名"><label>选择好友</label><div class="member-select">'.concat(S.friends.map((u) => '<label class="check-row">'.concat(av(u)).concat(esc(u.name), '<input type="checkbox" value="').concat(u.id, '" name="group-member"></label>')).join("") || '<p class="hint">请先查找用户。</p>', "</div>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">创建群聊</button>');
    modalHandler = async () => {
      const members = $$("input[name=group-member]:checked").map((x) => x.value);
      const c = await action("/api/conversations", { kind: "group", name: $("#group-name").value, members });
      closeModal();
      await refresh();
      selectConversation(c.id);
    };
  }
  function renderContactProfile() {
    const u = S.profile;
    $("#main-content").innerHTML = '<header class="chat-head">'.concat(btn("back", "返回", "back", "").replace('class="icon-btn"', 'class="icon-btn mobile-back"'), '<h2>个人资料</h2></header><div class="contact-profile">').concat(Contacts.profile(u), "</div>");
  }
  async function showRequests() {
    modal("联系人通知", '<div class="inline-loading">正在读取…</div>', "", true);
    await refresh();
    $(".modal-body").innerHTML = S.requests.map((q) => '<div class="utility-row">'.concat(av(q), '<div class="body"><b>').concat(esc(q.name), "</b><p>").concat(q.sender === S.user.id ? "我：" : "").concat(esc(q.message), "</p><p>").concat(shortTime(q.created), "</p></div>").concat(q.status === "pending" && q.recipient === S.user.id ? '<div class="request-actions"><button class="secondary" data-resolve="'.concat(q.id, '" data-accept="false">拒绝</button><button class="primary" data-resolve="').concat(q.id, '" data-accept="true">同意</button></div>') : '<span class="muted">'.concat({ pending: "等待验证", accepted: "已添加", rejected: "已拒绝", cancelled: "已取消" }[q.status], "</span>"), "</div>")).join("") || '<div class="empty-list">暂无联系人通知</div>';
  }
  async function chatDetail() {
    var _a, _b;
    if (((_a = activeConversation()) == null ? void 0 : _a.kind) === "group") {
      await Groups.detail();
      return;
    }
    const c = await api("/api/conversations/".concat(S.active)), mine = c.owner === S.user.id, local = activeConversation();
    modal("聊天设置", '<div class="detail-members">'.concat(c.members.map((u) => '<div class="detail-member">'.concat(av(u), "<span>").concat(esc(u.name)).concat(u.id === c.owner && c.kind === "group" ? " · 群主" : "", "</span></div>")).join(""), "</div>").concat(c.kind === "group" ? '<label>群名称</label><input id="detail-name" value="'.concat(esc(c.name), '" maxlength="60" ').concat(mine ? "" : "disabled", '><label>群公告</label><textarea id="detail-notice" maxlength="2000" placeholder="暂无群公告" ').concat(mine ? "" : "disabled", ">").concat(esc(c.announcement), "</textarea>") : "", '<button class="chat-history-entry" data-contact="edit" data-user="').concat(((_b = local.peer) == null ? void 0 : _b.id) || "", '">联系人设置</button><button class="chat-history-entry" data-action="search-history">查找聊天记录</button><label class="prefs-row">置顶聊天<input type="checkbox" id="detail-pin" ').concat(local.pinned ? "checked" : "", '></label><label class="prefs-row">消息免打扰<input type="checkbox" id="detail-mute" ').concat(local.muted ? "checked" : "", '></label><button class="chat-remove-entry" data-conversation-action="remove" data-cid="').concat(c.id, '">').concat(icon("trash"), "从消息列表移除</button>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">保存</button>');
    modalHandler = async () => {
      const p = { pinned: $("#detail-pin").checked, muted: $("#detail-mute").checked };
      if (c.kind === "group" && mine) {
        p.name = $("#detail-name").value;
        p.announcement = $("#detail-notice").value;
      }
      await api("/api/conversations/".concat(c.id), { method: "PATCH", body: p });
      closeModal();
      await refresh();
      renderMain();
      toast("已保存");
    };
  }
  async function inviteMembers() {
    const cid = S.active, c = await api("/api/conversations/".concat(cid));
    const list = S.friends.filter((u) => !c.members.some((m) => m.id === u.id));
    modal("邀请好友入群", '<div class="member-select">'.concat(list.map((u) => '<label class="check-row">'.concat(av(u)).concat(esc(u.name), '<input type="checkbox" name="invite-member" value="').concat(u.id, '"></label>')).join("") || '<p class="hint">好友都已在群里。</p>', "</div>"), '<button class="primary" data-action="modal-submit">邀请</button>');
    modalHandler = async () => {
      await action("/api/conversations/".concat(cid, "/members"), { members: $$("input[name=invite-member]:checked").map((x) => x.value) });
      closeModal();
      toast("已邀请好友入群");
    };
  }
  function searchHistory() {
    History.open();
  }
  async function renderFiles() {
    const n = $("#main-content");
    n.innerHTML = '<section class="utility"><h2>聊天文件</h2><div id="file-list" class="inline-loading">正在读取…</div></section>';
    const target = $("#file-list");
    try {
      const files = await api("/api/files"), list = $("#file-list");
      if (list !== target || S.tab !== "files") return;
      list.className = "";
      list.innerHTML = files.map((f) => '<div class="utility-row">'.concat(icon(f.mime.startsWith("image/") ? "image" : "file"), '<div class="body"><b>').concat(esc(f.name), "</b><p>").concat(bytes(f.size), " · ").concat(fullTime(f.created), "</p></div>").concat(btn("download", "下载", "download", 'data-download="'.concat(f.id, '" data-filename="').concat(esc(f.name), '"'))).concat(f.messageId ? btn("trash", "删除文件", "delete-chat-file", 'data-mid="'.concat(f.messageId, '" data-cid="').concat(f.conversationId, '" data-filename="').concat(esc(f.name), '"')) : "", "</div>")).join("") || '<div class="empty-list">发送和接收的文件会保存在这里</div>';
    } catch (e) {
      toast(e.message);
    }
  }
  async function renderFavorites() {
    $("#main-content").innerHTML = '<section class="utility"><h2>我的收藏</h2><div id="favorites-list" class="inline-loading">正在读取…</div></section>';
    try {
      const items = await api("/api/favorites"), list = $("#favorites-list");
      if (!list) return;
      list.className = "";
      list.innerHTML = items.map((m) => '<div class="utility-row">'.concat(av(m), '<div class="body"><b>').concat(esc(m.name), "</b><p>").concat(esc(preview(m)), "</p><p>").concat(fullTime(m.created), "</p>").concat(m.kind === "voice" || m.kind === "video" ? '<div class="favorite-media">'.concat(Media.bubble(m), "</div>") : "").concat(m.kind === "forward" ? '<button class="secondary" data-forward-view="'.concat(m.id, '">查看聊天记录</button>') : "").concat(m.attachmentId ? '<button class="secondary" data-download="'.concat(m.attachmentId, '" data-filename="').concat(esc(m.fileName), '">下载附件</button>') : "", "</div>").concat(btn("trash", "取消收藏", "unfavorite", 'data-mid="'.concat(m.id, '"')), "</div>")).join("") || '<div class="empty-list">在聊天中长按或右键消息，即可收藏</div>';
    } catch (e) {
      toast(e.message);
    }
  }
  async function openUserProfile(id) {
    modal("个人资料", '<div id="profile-loading" class="inline-loading">正在读取资料…</div>');
    const node = $("#profile-loading");
    try {
      const u = await api("/api/users/" + encodeURIComponent(id));
      if (!node.isConnected) return;
      modal("个人资料", '<div class="contact-profile">' + Contacts.profile(__spreadValues(__spreadValues({}, S.friends.find((p) => p.id === id)), u)) + "</div>");
    } catch (e) {
      if (node.isConnected) modalError(e);
    }
  }
  function profile(initial = {}) {
    const user = __spreadValues(__spreadValues({}, S.user), initial);
    modal("编辑资料", '<div style="text-align:center;margin:5px 0 25px"><button class="avatar-edit-button" data-avatar="user" aria-label="更换头像">'.concat(av(S.user, "large"), '<span class="avatar-edit-hint">更换头像</span></button></div><p class="hint">LinkMe 账号：').concat(esc(user.number), '</p><label>姓名</label><input id="profile-name" value="').concat(esc(user.name), '" maxlength="32"><label>手机号</label><input id="profile-phone" type="tel" autocomplete="tel" value="').concat(esc(user.phone || ""), '" maxlength="32" placeholder="未设置"><label>性别</label><select id="profile-gender"><option value="">未设置</option>').concat([["male", "男"], ["female", "女"], ["other", "其他"]].map(([v, t]) => '<option value="'.concat(v, '" ').concat(user.gender === v ? "selected" : "", ">").concat(t, "</option>")).join(""), '</select><label>职位</label><input id="profile-job" value="').concat(esc(user.jobTitle || ""), '" maxlength="64" placeholder="未设置"><label>个性签名</label><input id="profile-bio" value="').concat(esc(user.bio), '" maxlength="150" placeholder="分享此刻的心情"><p class="hint">点击头像，从 100 个卡通头像中挑选，或上传自己的照片。</p>'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">保存</button>');
    modalHandler = async () => {
      S.user = await api("/api/me", { method: "PATCH", body: { name: $("#profile-name").value, bio: $("#profile-bio").value, phone: $("#profile-phone").value, gender: $("#profile-gender").value, jobTitle: $("#profile-job").value, avatar: user.avatar } });
      closeModal();
      updateRail();
      if (S.tab === "profile") renderMyPage();
      toast("个人资料已更新");
    };
  }
  function renderMyPage() {
    $("#main-content").innerHTML = '<section class="utility"><div class="settings-body"><div class="contact-profile" style="padding:25px 0">'.concat(av(S.user, "large"), "<h2>").concat(esc(S.user.name), '</h2><span class="profile-line">LinkMe 号：').concat(esc(S.user.number || S.user.account), '</span></div><button class="utility-row" style="width:100%" data-action="profile">').concat(icon("user"), '<div class="body" style="text-align:left">个人资料</div>').concat(icon("chevron"), '</button><button class="utility-row" style="width:100%" data-nav="drive">').concat(icon("cloud"), '<div class="body" style="text-align:left">我的网盘</div>').concat(icon("chevron"), "</button>").concat(Admin.settingsRow(), '<button class="utility-row" style="width:100%" data-nav="files">').concat(icon("folder"), '<div class="body" style="text-align:left">我的文件</div>').concat(icon("chevron"), '</button><button class="utility-row" style="width:100%" data-nav="favorites">').concat(icon("star"), '<div class="body" style="text-align:left">我的收藏</div>').concat(icon("chevron"), "</button>").concat(S.config.platform === "android" ? '<button class="utility-row" style="width:100%" data-action="scan-qr"><div class="body" style="text-align:left">扫一扫 · 电脑登录</div></button>' : "", '<button class="utility-row" style="width:100%" data-action="settings">').concat(icon("settings"), '<div class="body" style="text-align:left">设置</div>').concat(icon("chevron"), "</button></div></section>");
  }
  async function settings() {
    await Sounds.ready;
    modal("设置", '<label class="prefs-row">深色外观<input type="checkbox" id="pref-dark" '.concat(document.body.classList.contains("dark") ? "checked" : "", "></label>").concat(Desktop.native ? "" : '<label class="prefs-row">' + (window.WeLinkAndroid ? "手机消息通知" : "桌面消息通知") + '<button class="secondary" data-action="notifications">开启通知</button></label>').concat(Sounds.row()).concat(window.WeLinkAndroid ? '<div class="prefs-row"><span>后台在线</span><button class="secondary" data-action="background">设置</button></div><p class="hint">离开 LinkMe 后，只要系统没有强制停止应用，仍会保持在线并接收消息。</p>' : "").concat(Desktop.settingsRow()).concat(Outbox.settingsRow()).concat(Received.settingsRow()).concat(Admin.settingsRow(), '<div class="prefs-row"><span>账号与安全</span><button class="secondary" data-action="security">管理</button></div><div class="prefs-row"><span>联系人与隐私</span><button class="secondary" data-contact="privacy">管理</button></div><div class="prefs-row"><span>当前版本</span><span>').concat(CLIENT_VERSION.replace("-preview", ""), ' 预览版</span></div><div class="prefs-row"><span>服务器</span><span>').concat(esc(S.config.server || "本地"), '</span></div><p class="hint">聊天记录保存在服务器，登录同一账号即可同步。<br>远程协助每次都需要对方明确同意。</p><button class="secondary" data-action="connection">连接设置</button> <button class="secondary" data-action="licenses">开源许可</button>'), '<button class="secondary danger" data-action="logout">退出登录</button><button class="primary" data-action="modal-submit">完成</button>');
    modalHandler = async () => {
      applyTheme($("#pref-dark").checked);
      localStorage.setItem("welink_dark", String($("#pref-dark").checked));
      closeModal();
    };
  }
  function connection() {
    modal("连接设置", '<label>服务地址</label><input id="server-url" value="'.concat(esc(S.config.server || ""), '" placeholder="http://服务器:8250"><label>HTTPS 证书指纹（可选）</label><input id="server-pin" value="').concat(esc(S.config.fingerprint || ""), '" placeholder="64 位十六进制指纹"><p class="hint">当前默认使用 HTTP。证书指纹仅在使用 HTTPS 时生效。</p>'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">保存连接</button>');
    modalHandler = async () => {
      const cfg = await action("/local/config", { server: $("#server-url").value, fingerprint: $("#server-pin").value });
      S.config = cfg;
      closeModal();
      await logout(false);
      toast("连接已更新，请登录");
    };
  }
  function contextMenu(x, y, items) {
    var _a;
    (_a = $(".context-menu")) == null ? void 0 : _a.remove();
    const n = document.createElement("div");
    n.className = "context-menu";
    n.innerHTML = items;
    document.body.append(n);
    const r = n.getBoundingClientRect();
    n.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    n.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  }
  function messageMenu(m, x, y) {
    contextMenu(x, y, (m.recalled ? "" : "".concat(Mentions.menu(m), '<button data-action="quote" data-mid="').concat(m.id, '">').concat(icon("reply"), '引用</button><button data-fw="single" data-mid="').concat(m.id, '">').concat(icon("send"), "转发</button>").concat(m.kind === "text" ? '<button data-action="copy-message" data-mid="'.concat(m.id, '">').concat(icon("copy"), "复制文字</button>") : "", '<button data-action="favorite" data-mid="').concat(m.id, '">').concat(icon("star"), "收藏</button>").concat(m.sender === S.user.id && Date.now() - m.created < 12e4 ? '<button data-action="recall" data-mid="'.concat(m.id, '">').concat(icon("history"), "撤回</button>") : "")) + '<button data-fw="select" data-mid="'.concat(m.id, '">').concat(icon("check"), '多选</button><button class="destructive" data-action="delete-message" data-mid="').concat(m.id, '">').concat(icon("trash"), "删除</button>"));
  }
  function emojis() {
    const old = $(".popup");
    if (old) {
      old.remove();
      return;
    }
    ;
    const d = document.createElement("div");
    d.className = "popup";
    d.innerHTML = '<div class="emoji-heading"><span>表情</span><button class="emoji-close" data-action="close-emoji" aria-label="关闭表情">' + icon("close") + "</button></div>" + "😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 🥰 😍 🤩 😘 😋 😎 🥳 🤔 🤗 🤭 🤫 😴 😪 😮 😯 😳 😱 😢 😭 😤 😡 🤯 🥺 😇 💙 ❤️ 💛 💚 💜 ✨ 🌟 🎉 🎈 🎁 🌷 🌸 🍀 ☀️ 🌈 ☕ 🍰 🍉 🍎 🎵 💡 🔥 👍 👋 👏 🤝 🙏 💪 👌 ✅".split(" ").map((v) => '<button data-emoji="'.concat(v, '">').concat(v, "</button>")).join("");
    $(".composer").append(d);
  }
  async function copyMessage(text) {
    var _a;
    if ((_a = navigator.clipboard) == null ? void 0 : _a.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw Error("复制失败，请重试");
    }
    toast("已复制");
  }
  function applyRecall(message) {
    var _a, _b;
    Received.event("recall", message).catch(() => {
    });
    Mentions.invalidated(message.id);
    Media.invalidate(message.id);
    Forwarding.invalidate(message.id);
    const i = S.messages.findIndex((m) => m.id === message.id);
    if (i >= 0) S.messages[i] = message;
    for (const m of S.messages) if (((_a = m.reply) == null ? void 0 : _a.id) === message.id) m.reply = __spreadProps(__spreadValues({}, m.reply), { text: "", fileName: "", recalled: true });
    if (((_b = S.reply) == null ? void 0 : _b.id) === message.id) {
      S.reply = null;
      renderReply();
    }
    History.changed(message.id, true);
    renderMessages(true);
    if (S.tab === "files") renderFiles();
    queueRefresh();
  }
  function deleteChatFile(button) {
    const { mid, cid, filename } = button.dataset;
    modal("删除聊天文件", "<p>删除「" + esc(filename) + '」及对应的文件消息？</p><p class="hint">会从你所有设备的聊天记录和文件列表中移除。对方的记录、你的收藏及已下载到设备的副本会保留。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary danger" data-action="modal-submit">删除</button>');
    modalHandler = async () => {
      await api("/api/messages/" + mid, { method: "DELETE" });
      applyDeletion({ id: mid, conversationId: cid });
      closeModal();
      toast("已删除聊天文件");
    };
  }
  function applyDeletion(message) {
    var _a;
    Received.event("message-deleted", message).catch(() => {
    });
    Mentions.invalidated(message.id);
    Media.invalidate(message.id);
    Forwarding.removed(message.id);
    if (S.active === message.conversationId) {
      S.messages = S.messages.filter((m) => m.id !== message.id);
      if (((_a = S.reply) == null ? void 0 : _a.id) === message.id) {
        S.reply = null;
        renderReply();
      }
      renderMessages(true);
    }
    History.changed(message.id);
    if (S.tab === "files") renderFiles();
    queueRefresh();
  }
  function deleteMessage(id) {
    const cid = S.active;
    modal("删除消息", '<p class="hint">删除后，这条消息将从你所有设备的聊天记录中移除。对方的记录和你已保存的收藏会保留。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">删除</button>');
    modalHandler = async () => {
      await api("/api/messages/" + id, { method: "DELETE" });
      applyDeletion({ id, conversationId: cid });
      closeModal();
      toast("已删除消息");
    };
  }
  async function jumpMessage(cid, id) {
    const current = S.messages.find((m) => m.id === id);
    if (S.active !== cid || !current) {
      const messages = await api("/api/conversations/" + cid + "/messages?around=" + encodeURIComponent(id));
      S.active = cid;
      S.messages = messages;
      S.historyMode = true;
      S.tab = "messages";
      S.profile = null;
      S.reply = Outbox.replyPlaceholder(cid);
      renderShell();
      Outbox.restoreReply(cid).catch(() => {
      });
    }
    closeModal();
    const target = document.querySelector('[data-message="' + id + '"]');
    if (!target) throw Error("消息已删除或不可访问");
    target.scrollIntoView({ block: "center", behavior: "auto" });
    target.classList.remove("highlight-message");
    void target.offsetWidth;
    target.classList.add("highlight-message");
  }
  async function screenshot() {
    return Screenshots.start();
  }
  var RemoteDisplay = createRemoteWindow({ active: () => !!$(".remote-screen"), action, toast });
  function remoteChoices() {
    const c = activeConversation();
    if ((c == null ? void 0 : c.kind) !== "direct") {
      toast("请在好友单聊中使用远程协助");
      return;
    }
    modal("远程协助", '<button class="remote-choice" data-invite-remote="control" data-direction="request">'.concat(icon("monitor"), '<span><b>请求控制对方设备</b><p>对方同意后，帮助对方操作</p></span></button><button class="remote-choice" data-invite-remote="view" data-direction="request">').concat(icon("video"), '<span><b>请求观看对方屏幕</b><p>只看画面，不操作对方设备</p></span></button><button class="remote-choice" data-invite-remote="control" data-direction="share">').concat(icon("contacts"), '<span><b>邀请对方协助我</b><p>共享我的屏幕，允许对方操作</p></span></button><p class="hint">邀请会持续到接听、拒绝或取消。安卓共享需要系统屏幕录制授权，触控需要无障碍权限。</p>'));
  }
  async function ensureSharing() {
    if (S.config.platform === "android") {
      if (!window.WeLinkAndroid) throw Error("当前环境不支持 Android 屏幕共享");
      window.WeLinkAndroid.requestSharing();
      const deadline = Date.now() + 6e4;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        const s = await api("/local/remote/state");
        if (s.sharing) return s;
      }
      throw Error("屏幕共享未获授权");
    }
    return api("/local/remote/state");
  }
  async function inviteRemote(mode, direction) {
    const local = direction === "share" ? await ensureSharing() : await api("/local/remote/state");
    const v = await action("/api/remotes", { conversationId: S.active, mode, direction, deviceId: local.deviceId });
    S.remote = v;
    closeModal();
    renderRemoteWait(v);
  }
  function renderRemoteWait(v) {
    var _a;
    modal("远程协助", '<div class="remote-invite">'.concat(av(((_a = activeConversation()) == null ? void 0 : _a.peer) || {}, "large"), "<h3>等待对方接受邀请…</h3><p>邀请正在等待响应<br>你可以随时取消</p></div>"), '<button class="secondary" data-action="stop-remote">取消邀请</button>');
    clearTimeout(toastTimer);
  }
  async function remoteEvent(v) {
    var _a, _b, _c, _d;
    if (!S.user) return;
    const key = "remote/" + v.id;
    if (v.state === "pending") {
      if (v.requester === S.user.id) return;
      Desktop.activity(key, v.recipient === S.user.id);
      if (v.recipient !== S.user.id) return;
      if (((_a = S.remote) == null ? void 0 : _a.id) === v.id) return;
      S.remote = v;
      if (S.config.platform === "windows" && typeof window.welinkTakeNativeInviteAction === "function") return;
      const from = S.friends.find((u) => u.id === v.requester) || { name: "好友" };
      modal("远程协助邀请", '<div class="remote-invite">'.concat(av(from, "large"), "<h3>").concat(esc(from.name), "</h3><p>").concat(v.host === S.user.id ? v.mode === "control" ? "请求观看并控制你的设备" : "请求观看你的屏幕" : "邀请你远程协助", "<br>同意后开始，随时可以结束</p></div>"), '<button class="secondary" data-action="reject-remote">拒绝</button><button class="primary" data-action="accept-remote">同意</button>');
      return;
    }
    ;
    Desktop.activity(key, false);
    (_c = (_b = window.WeLinkAndroid) == null ? void 0 : _b.dismissNativeInvite) == null ? void 0 : _c.call(_b, "remote:" + v.id);
    if (((_d = S.remote) == null ? void 0 : _d.id) !== v.id) return;
    S.remote = v;
    if (v.state === "accepted") {
      clearTimeout(toastTimer);
      if (v.host !== S.user.id || v.requester === S.user.id) try {
        await startRemote(v);
      } catch (e) {
        toast(e.message);
        await stopRemote();
      }
    } else {
      await stopRemote(false);
      if (v.state === "rejected") toast("对方拒绝了远程邀请");
      else toast("远程协助已结束");
    }
  }
  async function acceptRemote(accept) {
    const v = S.remote;
    if (!v) return;
    let local;
    if (accept && v.host === S.user.id) local = await ensureSharing();
    const result = await action("/api/remotes/".concat(v.id, "/respond"), { accept, deviceId: (local == null ? void 0 : local.deviceId) || "" });
    S.remote = result;
    closeModal();
    if (accept) await startRemote(result);
    else S.remote = null;
  }
  async function startRemote(v) {
    await action("/local/remote/start", { id: v.id, token: S.token });
    closeModal();
    S.remote = v;
    clearInterval(S.remoteTimer);
    if (v.host !== S.user.id) showRemoteScreen();
    else renderSharing();
    S.remoteTimer = setInterval(remoteTick, 33);
    await remoteTick();
  }
  var frameVersion = 0;
  var frameURL = "";
  var remoteTickBusy = false;
  var remoteInput = null;
  async function remoteTick() {
    if (remoteTickBusy || !S.remote) return;
    remoteTickBusy = true;
    try {
      const state = await api("/local/remote/state");
      S.remoteLocal = state;
      const status = $("#remote-status");
      if (status) status.textContent = state.status === "connected" ? "".concat(state.path === "p2p" ? "P2P 直连" : "加密中转", " · ").concat(state.rtt, " ms · ").concat(state.width, "×").concat(state.height) : state.error || "正在建立加密连接…";
      if (state.status === "ended") {
        const error = state.error;
        await stopRemote();
        if (error) toast(error);
        return;
      }
      if (state.role === "viewer" && state.frame !== frameVersion && state.frame) {
        frameVersion = state.frame;
        const r = await fetch("/local/remote/frame");
        if (r.ok) {
          const blob = await r.blob();
          const img = $("#remote-image");
          if (img) {
            const old = frameURL;
            frameURL = URL.createObjectURL(blob);
            img.src = frameURL;
            img.onload = () => {
              var _a;
              URL.revokeObjectURL(old);
              (_a = $("#remote-loading")) == null ? void 0 : _a.classList.add("hidden");
            };
            img.dataset.width = state.width;
            img.dataset.height = state.height;
          }
        }
      }
    } catch (e) {
      toast(e.message);
      await stopRemote(false);
    } finally {
      remoteTickBusy = false;
    }
  }
  function renderSharing() {
    var _a;
    const el = $("#sharing-banner");
    if (!el) return;
    el.innerHTML = ((_a = S.remote) == null ? void 0 : _a.state) === "accepted" && S.remote.host === S.user.id ? '<div class="sharing-banner">'.concat(icon("monitor"), "<span>正在共享屏幕").concat(S.remote.mode === "control" ? "，对方可以操作" : "", '</span><button data-action="stop-remote">结束共享</button></div>') : "";
  }
  function showRemoteScreen() {
    if ($(".remote-screen")) return;
    const node = document.createElement("section");
    node.className = "remote-screen";
    node.innerHTML = '<header class="remote-toolbar">'.concat(icon("monitor"), '<b>远程协助</b><span id="remote-status" class="status">正在连接…</span><button class="secondary" data-action="remote-fullscreen" aria-pressed="false">全屏</button>').concat(S.config.platform !== "android" ? '<button class="secondary" data-action="remote-minimize" aria-label="最小化远程窗口">最小化</button>' : "", '<button class="primary" data-action="stop-remote">结束协助</button></header><div class="remote-canvas"><p id="remote-loading">正在等待对方画面…</p><img id="remote-image" tabindex="0" alt="远程设备屏幕"></div><div class="remote-touchbar"><button data-remote-key="Escape">返回</button><button data-remote-key="Home">主页</button><button data-action="remote-text">输入文字</button><button data-remote-key="Enter">回车</button></div>');
    document.body.append(node);
    const img = $("#remote-image");
    let held = false;
    remoteInput = createRemoteInput((events) => action("/local/remote/input", { events }), () => action("/local/remote/release"), (e) => toast(e.message));
    const send = remoteInput.push;
    const point = (e) => remotePoint(e, img);
    let moveAt = 0;
    img.onpointerdown = (e) => {
      var _a;
      if (((_a = S.remote) == null ? void 0 : _a.mode) !== "control") return;
      e.preventDefault();
      img.focus();
      img.setPointerCapture(e.pointerId);
      held = true;
      send([point(e), { type: "down", button: e.button === 2 ? 3 : 1 }]);
    };
    img.onpointermove = (e) => {
      var _a;
      if (((_a = S.remote) == null ? void 0 : _a.mode) !== "control" || Date.now() - moveAt < 8) return;
      moveAt = Date.now();
      send([point(e)]);
    };
    img.onpointerup = (e) => {
      if (!held) return;
      held = false;
      send([point(e), { type: "up", button: e.button === 2 ? 3 : 1 }]);
    };
    img.onpointercancel = () => {
      held = false;
      remoteInput == null ? void 0 : remoteInput.release();
    };
    img.oncontextmenu = (e) => e.preventDefault();
    img.onwheel = (e) => {
      var _a;
      if (((_a = S.remote) == null ? void 0 : _a.mode) !== "control") return;
      e.preventDefault();
      send([{ type: "wheel", deltaY: Math.round(e.deltaY), deltaX: Math.round(e.deltaX) }]);
    };
    img.onkeydown = (e) => {
      var _a;
      if (((_a = S.remote) == null ? void 0 : _a.mode) !== "control") return;
      e.preventDefault();
      send([{ type: "key_down", key: e.key, code: e.code }]);
    };
    img.onkeyup = (e) => {
      var _a;
      if (((_a = S.remote) == null ? void 0 : _a.mode) !== "control") return;
      e.preventDefault();
      send([{ type: "key_up", key: e.key, code: e.code }]);
    };
    img.onblur = () => remoteInput == null ? void 0 : remoteInput.release();
  }
  async function stopRemote(notify = true) {
    var _a;
    remoteInput == null ? void 0 : remoteInput.close();
    remoteInput = null;
    const v = S.remote;
    S.remote = null;
    S.remoteLocal = null;
    clearInterval(S.remoteTimer);
    clearTimeout(toastTimer);
    S.remoteTimer = null;
    await RemoteDisplay.exit().catch(() => {
    });
    (_a = $(".remote-screen")) == null ? void 0 : _a.remove();
    frameVersion = 0;
    URL.revokeObjectURL(frameURL);
    frameURL = "";
    closeModal();
    renderSharing();
    try {
      await action("/local/remote/stop");
    } catch (e) {
    }
    if (notify && v) try {
      await action("/api/remotes/".concat(v.id, "/end"));
    } catch (e) {
    }
  }
  async function download(id, name) {
    if (window.WeLinkAndroid) {
      window.WeLinkAndroid.downloadFile(fileURL(id), name || "文件");
      return;
    }
    const a = document.createElement("a");
    a.href = fileURL(id);
    a.download = name || "文件";
    document.body.append(a);
    a.click();
    a.remove();
  }
  document.addEventListener("click", async (e) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const avatar = e.target.closest(".message .avatar[data-avatar-user],.detail-member .avatar[data-avatar-user]");
    if (avatar) {
      openUserProfile(avatar.dataset.avatarUser);
      return;
    }
    const b = e.target.closest("button,a,[data-preview-image]");
    (_a = $(".context-menu")) == null ? void 0 : _a.remove();
    if (!b) return;
    try {
      if (b.dataset.nav) {
        navigatePage(b);
        return;
      }
      if (b.dataset.contactTab) {
        S.contactTab = b.dataset.contactTab;
        renderSidebar();
        return;
      }
      if (b.dataset.conversation) {
        await selectConversation(b.dataset.conversation);
        return;
      }
      if (b.dataset.profile) {
        if (b.dataset.profile === S.user.id) {
          await openUserProfile(S.user.id);
          return;
        }
        S.profile = S.friends.find((u) => u.id === b.dataset.profile);
        renderMain();
        $(".shell").classList.add("in-chat");
        const id = b.dataset.profile;
        const detail = await api("/api/users/" + id);
        if (S.tab === "contacts" && ((_b = S.profile) == null ? void 0 : _b.id) === id) {
          S.profile = __spreadValues(__spreadValues({}, S.profile), detail);
          renderMain();
        }
        return;
      }
      if (b.dataset.userCall) {
        closeModal();
        const c = await action("/api/conversations", { kind: "direct", members: [b.dataset.userCall] });
        await refresh();
        await selectConversation(c.id);
        await Calls.dial(c.id, b.dataset.userCallMode === "video" ? "video" : "audio");
        return;
      }
      if (b.dataset.startChat) {
        closeModal();
        const c = await action("/api/conversations", { kind: "direct", members: [b.dataset.startChat] });
        await refresh();
        await selectConversation(c.id);
        return;
      }
      if (b.dataset.requestUser) {
        requestFriend(b.dataset.requestUser, b.dataset.name);
        return;
      }
      if (b.dataset.resolve) {
        await action("/api/requests/" + b.dataset.resolve, { accept: b.dataset.accept === "true" });
        await showRequests();
        return;
      }
      if (b.dataset.color) {
        $$(".color-list button").forEach((x) => x.classList.toggle("selected", x === b));
        return;
      }
      if (b.dataset.emoji) {
        const input = $("#composer");
        const start = input.selectionStart;
        input.value = input.value.slice(0, start) + b.dataset.emoji + input.value.slice(input.selectionEnd);
        input.dispatchEvent(new Event("input"));
        input.focus();
        input.setSelectionRange(start + b.dataset.emoji.length, start + b.dataset.emoji.length);
        return;
      }
      if (b.dataset.inviteRemote) {
        await inviteRemote(b.dataset.inviteRemote, b.dataset.direction);
        return;
      }
      if (b.dataset.remoteKey) {
        await action("/local/remote/input", { events: [{ type: "key", key: b.dataset.remoteKey }] });
        return;
      }
      if (b.dataset.download) {
        await download(b.dataset.download, b.dataset.filename);
        return;
      }
      if (b.dataset.previewImage) {
        $("#overlays").innerHTML = '<div class="modal-backdrop" data-action="close-modal"><img class="image-preview" src="'.concat(fileURL(b.dataset.previewImage), '" alt="图片预览"></div>');
        return;
      }
      const a = b.dataset.action;
      if (!a) return;
      (_c = $(".context-menu")) == null ? void 0 : _c.remove();
      switch (a) {
        case "register":
          renderAuth(true);
          break;
        case "login":
          renderAuth(false);
          break;
        case "close-modal":
          if (((_d = S.remote) == null ? void 0 : _d.state) === "pending" && $(".remote-invite")) Navigation.back();
          else if (b.closest(".modal-footer") && b.textContent.trim() === "取消") Navigation.back();
          else finishModal();
          break;
        case "modal-back":
          Navigation.back();
          break;
        case "page-back":
          pageBack();
          break;
        case "modal-submit":
          if (modalHandler) {
            b.disabled = true;
            try {
              await modalHandler();
            } finally {
              b.disabled = false;
            }
          }
          break;
        case "window-min":
        case "window-max":
        case "window-close":
          await action("/local/window/" + a.slice(7));
          break;
        case "connection":
          connection();
          break;
        case "licenses": {
          const text = await (await fetch("/assets/licenses.txt")).text();
          modal("开源许可", '<pre class="license-text">' + esc(text) + "</pre>", "", true);
          break;
        }
        case "profile":
          profile();
          break;
        case "settings":
          settings();
          break;
        case "logout":
          await logout();
          break;
        case "send":
          await sendMessage();
          break;
        case "back":
          pageBack();
          break;
        case "add-friend":
          addFriend();
          break;
        case "create-group":
          createGroup();
          break;
        case "requests":
          await showRequests();
          break;
        case "add-menu": {
          const r = b.getBoundingClientRect();
          contextMenu(r.left - 120, r.bottom + 5, '<button data-action="create-group">'.concat(icon("chat"), "创建群聊</button>").concat(S.config.platform === "android" ? '<button data-action="scan-qr">扫一扫</button>' : ""));
          break;
        }
        case "more-menu": {
          const r = b.getBoundingClientRect();
          contextMenu(r.left + 40, r.top - 80, '<button data-action="settings">'.concat(icon("settings"), '设置</button><button data-action="logout">').concat(icon("logout"), "退出登录</button>").concat(Desktop.exitMenu()));
          break;
        }
        case "emoji":
          emojis();
          break;
        case "close-emoji":
          (_e = $(".popup")) == null ? void 0 : _e.remove();
          (_f = $("#composer")) == null ? void 0 : _f.focus();
          break;
        case "image":
          $("#image-input").click();
          break;
        case "file":
          $("#file-input").click();
          break;
        case "screenshot":
          await screenshot();
          break;
        case "search-history":
          searchHistory();
          break;
        case "chat-detail":
          await chatDetail();
          break;
        case "invite-members":
          await inviteMembers();
          break;
        case "quote":
          S.reply = S.messages.find((m) => m.id === b.dataset.mid);
          Outbox.saveDraft().catch(() => {
          });
          renderReply();
          (_g = $("#composer")) == null ? void 0 : _g.focus();
          break;
        case "cancel-reply":
          S.reply = null;
          Outbox.saveDraft().catch(() => {
          });
          renderReply();
          break;
        case "favorite":
          await action("/api/favorites/" + b.dataset.mid);
          toast("已收藏");
          break;
        case "unfavorite":
          await api("/api/favorites/" + b.dataset.mid, { method: "DELETE" });
          await renderFavorites();
          break;
        case "copy-message":
          await copyMessage(((_h = S.messages.find((m) => m.id === b.dataset.mid)) == null ? void 0 : _h.text) || "");
          break;
        case "delete-chat-file":
          deleteChatFile(b);
          break;
        case "delete-message":
          deleteMessage(b.dataset.mid);
          break;
        case "jump-message":
          await jumpMessage(S.active, b.dataset.mid);
          break;
        case "latest-messages":
          await selectConversation(S.active);
          break;
        case "load-newer": {
          const cid = S.active, area = $("#messages"), top = area.scrollTop;
          const ms = await api("/api/conversations/".concat(cid, "/messages?after=").concat(S.messages[S.messages.length - 1].seq));
          if (S.active !== cid) break;
          if (!ms.length) {
            toast(S.cacheView ? "已到本机缓存的最新消息" : "已到最新消息");
            S.historyMode = false;
          } else S.messages.push(...ms.filter((m) => !S.messages.some((x) => x.id === m.id)));
          renderMessages(true);
          area.scrollTop = top;
          break;
        }
        case "recall": {
          const m = await action("/api/messages/" + b.dataset.mid + "/recall");
          applyRecall(m);
          break;
        }
        case "load-older": {
          const cid = S.active, seq = (_i = S.messages[0]) == null ? void 0 : _i.seq;
          if (!cid || !seq) break;
          const older = await api("/api/conversations/".concat(cid, "/messages?before=").concat(seq));
          if (S.active !== cid || ((_j = S.messages[0]) == null ? void 0 : _j.seq) !== seq) break;
          if (!older.length) {
            b.remove();
            toast(S.cacheView ? "没有更早的本机缓存，联网后可继续加载" : "已经是最早的消息");
            break;
          }
          const area = $("#messages"), h = area.scrollHeight;
          S.messages = [...older, ...S.messages];
          renderMessages(true);
          area.scrollTop = area.scrollHeight - h;
          break;
        }
        case "background":
          if ((_k = window.WeLinkAndroid) == null ? void 0 : _k.requestBackgroundReliability) window.WeLinkAndroid.requestBackgroundReliability();
          else toast("当前版本无需设置");
          break;
        case "notifications":
          if (window.WeLinkAndroid) {
            window.WeLinkAndroid.requestNotifications();
            break;
          }
          if ("Notification" in window) {
            const p = await Notification.requestPermission();
            toast(p === "granted" ? "已开启桌面通知" : "通知权限未开启");
          }
          break;
        case "remote":
          remoteChoices();
          break;
        case "accept-remote":
          b.disabled = true;
          await acceptRemote(true);
          break;
        case "reject-remote":
          await acceptRemote(false);
          break;
        case "stop-remote":
          await stopRemote();
          break;
        case "remote-fullscreen":
          await RemoteDisplay.toggle();
          break;
        case "remote-minimize":
          await RemoteDisplay.minimize();
          break;
        case "remote-text":
          modal("输入文字", '<textarea id="remote-text" placeholder="输入要发送到远程设备的文字"></textarea>', '<button class="primary" data-action="modal-submit">发送</button>');
          modalHandler = async () => {
            await action("/local/remote/input", { events: [{ type: "text", text: $("#remote-text").value }] });
            closeModal();
          };
          break;
      }
    } catch (err) {
      modalError(err);
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop") && (!S.remote || S.remote.state === "pending")) Navigation.back();
  });
  document.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("[data-message]");
    if (el) {
      e.preventDefault();
      const m = S.messages.find((x) => x.id === el.dataset.message);
      if (m) messageMenu(m, e.clientX, e.clientY);
    }
  });
  bindLongPress("[data-message]", (node, x, y) => {
    const message = S.messages.find((m) => m.id === node.dataset.message);
    if (message) messageMenu(message, x, y);
  });
  document.addEventListener("pointerdown", (event) => {
    var _a;
    if (!event.target.closest(".popup,[data-action=emoji]")) (_a = $(".popup")) == null ? void 0 : _a.remove();
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (!Desktop.hidden()) {
      document.title = "LinkMe";
      if (S.active && S.user) markRead().catch(() => {
      });
    } else action("/local/remote/release").catch(() => {
    });
  });
  document.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && window.welinkDrag && !e.target.closest("#overlays,#meeting-layer,button,input,textarea,a") && (e.target.closest(".chat-head") || e.clientY < 28)) window.welinkDrag();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && (!S.remote || S.remote.state === "pending") && Navigation.handleBack()) {
      e.preventDefault();
    }
  });
  window.addEventListener("storage", (event) => {
    if ((event.key === "welink_token" || event.key === null) && S.token && localStorage.getItem("welink_token") !== S.token) logout(false);
  });
  applyTheme(localStorage.getItem("welink_dark") === "true");
  var Directory = createDirectorySearch({ S, api, esc, av, icon, renderSidebar, contextMenu });
  var Received = createReceivedCache({ S, toast, modal, closeModal: finishModal, esc, bytes, connectionState, onReconciled: (cid, messages, ids, denied) => {
    if (S.active !== cid) return;
    const live = new Map(messages.map((m) => [m.id, m])), checked = new Set(ids);
    S.messages = denied ? [] : S.messages.filter((m) => !checked.has(m.id) || live.has(m.id)).map((m) => live.get(m.id) || m);
    if (S.reply && (denied || checked.has(S.reply.id) && (!live.has(S.reply.id) || live.get(S.reply.id).recalled))) {
      S.reply = null;
      renderReply();
    }
    renderMessages(true);
  } });
  var Transfers = createTransfers({ S, api, esc, av, bytes, randomID, renderMessages, queueRefresh, toast });
  var Cloud = createCloud({ S, api, modal, closeModal, toast, esc, icon, bytes, fullTime, upload: Transfers.upload });
  createConversationActions({ S, api, modal, closeModal, toast, esc, icon, contextMenu, refresh });
  var Admin = createAdmin({ S, api, modal, closeModal, toast, esc, icon, refresh });
  var Media = createMedia({ S, api, action, modal, closeModal, toast, esc, icon, fileURL, randomID, renderMessages, queueRefresh, upload, enqueue: (...args) => Outbox.enqueue(...args) });
  var Desktop = createDesktop({ S, modal, closeModal: finishModal, toast, markRead, esc });
  var Sounds = createMessageSounds({ toast, native: Desktop.native, hidden: Desktop.hidden });
  var Screenshots = createScreenshots({ S, modal, closeModal, toast, esc, upload });
  var Avatars = createAvatars({ S, api, modal, closeModal, toast, esc, av, refresh, renderMessages, renderMain, updateRail, profile, groupDetail: (id) => Groups.detail(id) });
  var Mentions = createMentions({ S, api, esc, av, toast, jump: jumpMessage });
  var Me = createMe({ S, api, action, esc, icon, modal, closeModal, toast, refresh, selectConversation, renderSidebar });
  var Outbox = createOutbox({ onSent: (message) => Me.onSent(message), sendLarge: Transfers.chat, S, api, toast, esc, av, bytes, randomID, Mentions, renderMessages, renderReply, queueRefresh, modal, closeModal: finishModal });
  var Groups = createGroups({ S, api, action, modal, closeModal, toast, esc, icon, av, refresh, selectConversation, renderMain, copy: copyMessage, stopMedia: () => Media.reset() });
  var Contacts = createContacts({ S, api, action, modal, closeModal: finishModal, toast, esc, icon, av, refresh, renderSidebar, renderMain, stopMedia: () => Media.reset(), requestFriend, contextMenu });
  var Forwarding = createForwarding({ S, api, action, modal, closeModal, toast, esc, icon, av, preview, fullTime, bytes, fileURL, randomID, renderMessages, queueRefresh, mediaBubble: Media.bubble });
  var History = createHistory({ S, api, modal, toast, esc, preview, fullTime, jump: jumpMessage });
  var Meetings = createMeetings({ api, action, S, modal, closeModal, toast, esc, icon, Desktop, onCallClosed: (id) => Calls.mediaClosed(id), callCurrent: (id) => Calls.isCurrent(id), historyEntry: () => Calls.historyEntry() });
  var Calls = createCalls({ S, api, action, esc, av, icon, toast, modal, closeModal, randomID, Meetings, Desktop, renderMessages, queueRefresh, fullTime });
  async function nativeInviteEvent(event) {
    const n = event.detail;
    if (!S.user || !n || n.userId && n.userId !== S.user.id) return;
    if (n.type === "call") await Calls.changed(n);
    else if (n.type === "meeting") {
      if (n.state === "ended") Meetings.ended(n);
      else await Meetings.invited(n);
    } else if (n.type === "remote") await remoteEvent(n);
  }
  async function nativeInviteAction(event) {
    var _a, _b;
    const { action: choice, notification: n } = event.detail || {};
    if (!S.user || !n || n.userId && n.userId !== S.user.id || !["accept", "reject"].includes(choice)) return;
    if (n.type === "call") {
      await Calls.nativeAction(n.id, choice === "accept");
      return;
    }
    if (n.type === "meeting") {
      await Meetings.nativeAction(n.code, choice === "accept");
      return;
    }
    if (n.type === "remote") {
      const current = await api("/api/remotes/" + n.id);
      if (current.state !== "pending") {
        await remoteEvent(current);
        return;
      }
      if (((_a = S.remote) == null ? void 0 : _a.id) !== current.id) await remoteEvent(current);
      if (((_b = S.remote) == null ? void 0 : _b.id) === current.id) await acceptRemote(choice === "accept");
    }
  }
  var nativeInviteQueue = Promise.resolve();
  window.addEventListener("welink-native-invite-event", (event) => {
    nativeInviteQueue = nativeInviteQueue.then(() => nativeInviteEvent(event)).catch((e) => toast(e.message));
  });
  window.addEventListener("welink-native-invite-action", (event) => {
    nativeInviteQueue = nativeInviteQueue.then(() => nativeInviteAction(event)).catch((e) => toast(e.message));
  });
  var Security = createSecurity({ api, action, S, modal, toast, esc, icon, logout });
  var QR = createQRLogin({ action, S, modal, toast, esc, enter, renderAuth, windows, logo, icon });
  var EmailAuth = createEmailAuth({ S, action, enter, QR, Desktop, windows, logo });
  async function loadRegistration() {
    try {
      const response = await Promise.race([fetch("/api/public-config"), new Promise((_, reject) => setTimeout(() => reject(Error("config timeout")), 4e3))]);
      if (!response.ok) return;
      const value = await response.json();
      S.registrationEnabled = !!value.registrationEnabled;
      S.emailAuthEnabled = true;
      const links = document.querySelector("#auth-form .auth-links");
      if (links && !S.user) {
        const button = links.querySelector("[data-action=register],[data-email-mode=register]");
        if (S.registrationEnabled && !button && !links.querySelector("[data-email-mode=login]")) {
          links.insertAdjacentHTML("afterbegin", '<button type="button" data-email-mode="register">注册账号</button>');
          links.querySelector("[data-email-mode=register]").onclick = () => {
            var _a;
            return EmailAuth.render("register", ((_a = document.querySelector("#auth-form [name=email]")) == null ? void 0 : _a.value) || "");
          };
        }
        if (!S.registrationEnabled) button == null ? void 0 : button.remove();
      }
    } catch (e) {
    }
  }
  var bootstrapping = false;
  async function bootstrap() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      S.config = await api("/local/config");
      loadRegistration();
      if (S.token) {
        try {
          S.user = await api("/api/me");
          await enter();
        } catch (error) {
          if (error.status === 401) {
            S.token = "";
            localStorage.removeItem("welink_token");
            renderAuth();
          } else throw error;
        }
      } else renderAuth();
    } catch (error) {
      Outbox.stop();
      S.user = null;
      $("#app").innerHTML = '<main class="auth-shell">' + windows() + '<section class="auth-card">' + logo() + '<h2>正在重新连接</h2><p class="subtitle">登录状态与本机草稿已保留</p><p class="auth-error">' + esc(error.message) + '</p><button class="primary" id="retry-connect">立即重试</button><div class="auth-links"><button data-action="logout">返回登录</button><button data-action="connection">连接设置</button></div></section></main>';
      $("#retry-connect").onclick = bootstrap;
      setTimeout(() => {
        if ($("#retry-connect")) bootstrap();
      }, 1e4);
    } finally {
      bootstrapping = false;
    }
  }
  bootstrap();
  var fileDragDepth = 0;
  var fileDrag = (e) => {
    var _a;
    return Array.from(((_a = e.dataTransfer) == null ? void 0 : _a.types) || []).includes("Files");
  };
  document.addEventListener("dragenter", (e) => {
    var _a;
    if (!fileDrag(e) || !S.user) return;
    e.preventDefault();
    if (S.tab === "drive" || S.tab === "messages" && S.active) {
      fileDragDepth++;
      (_a = document.querySelector(".shell")) == null ? void 0 : _a.classList.add("file-drop-active");
    }
  });
  document.addEventListener("dragover", (e) => {
    if (fileDrag(e)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
  });
  document.addEventListener("dragleave", (e) => {
    var _a;
    if (fileDrag(e) && --fileDragDepth <= 0) (_a = document.querySelector(".shell")) == null ? void 0 : _a.classList.remove("file-drop-active");
  });
  document.addEventListener("drop", async (e) => {
    var _a;
    if (!fileDrag(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    (_a = document.querySelector(".shell")) == null ? void 0 : _a.classList.remove("file-drop-active");
    const files = Array.from(e.dataTransfer.files || []), cid = S.active, owner2 = S.token;
    if (!S.user) return;
    if (S.tab === "drive") {
      await Cloud.sendFiles(files);
      return;
    }
    if (S.tab !== "messages" || !cid) {
      toast("请先打开聊天或网盘");
      return;
    }
    for (const file of files) {
      if (S.token !== owner2) return;
      await upload(file, false, cid);
    }
  });
  var creatingGroups = /* @__PURE__ */ new Set();
  document.addEventListener("click", async (event) => {
    const b = event.target.closest("[data-create-group-user]");
    if (!b || !S.user) return;
    const id = b.dataset.createGroupUser;
    if (id === S.user.id || creatingGroups.has(id)) return;
    creatingGroups.add(id);
    try {
      const c = await action("/api/conversations", { kind: "group", members: [id] });
      closeModal();
      await refresh();
      await selectConversation(c.id);
    } catch (e) {
      toast(e.message);
    } finally {
      creatingGroups.delete(id);
    }
  });
})();
