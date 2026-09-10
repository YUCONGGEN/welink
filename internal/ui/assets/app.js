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
      modal2("群聊设置", '<div class="group-summary">'.concat(av2({ kind: "group", avatar: "group", name: c.name }, "large"), "<div><h3>").concat(esc2(c.name), "</h3><p>群号 ").concat(esc2(g.number), ' <button class="group-link" data-group="copy-number">复制</button></p><small>').concat(g.count, " 人 · ").concat(roles[g.role], '</small></div></div><div class="group-member-grid">').concat(c.members.slice(0, 9).map((u) => '<button data-group-user="'.concat(u.id, '">').concat(av2(u), "<span>").concat(esc2(u.nickname || u.name), "</span>").concat(u.role !== "member" ? '<small class="group-role '.concat(u.role, '">').concat(roles[u.role], "</small>") : "", "</button>")).join("")).concat(manager(g) || g.membersInvite ? '<button data-group="invite" class="group-add-member">' + icon2("plus") + "<span>邀请</span></button>" : "", "</div>").concat(row("群聊成员", g.count + " 人", "members")).concat(row("群公告", esc2(((_a = c.announcement) == null ? void 0 : _a.slice(0, 24)) || "暂无公告"), "announcement")).concat(row("我的群名片", esc2((me == null ? void 0 : me.nickname) || (me == null ? void 0 : me.name) || ""), "my-card")).concat(manager(g) ? row("群管理", "入群方式、管理员、禁言", "manage") + row("加群申请", (S2.groupRequests || []).filter((x) => x.conversationId === cid && x.canReview && x.status === "pending").length + " 条待处理", "requests") : "").concat(row("查找聊天记录", "", "history"), '<label class="prefs-row">置顶聊天<input type="checkbox" id="group-pin" ').concat(local.pinned ? "checked" : "", '></label><label class="prefs-row">消息免打扰<input type="checkbox" id="group-notifications" ').concat(local.muted ? "checked" : "", '></label><p class="hint">').concat(esc2(g.description || "暂无群介绍"), '</p><button class="group-danger" data-group="').concat(g.role === "owner" ? "dissolve" : "leave", '">').concat(g.role === "owner" ? "解散该群" : "退出该群", "</button>"), '<button class="primary" id="group-save-prefs">完成</button>', true);
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
      modal2("群成员资料", '<div class="group-summary">'.concat(av2(u, "large"), "<div><h3>").concat(esc2(u.name), "</h3><p>WeLink 号 ").concat(esc2(u.number), '</p><span class="group-role ').concat(u.role, '">').concat(roles[u.role], '</span></div></div><label for="group-member-card">群名片</label><input id="group-member-card" maxlength="32" value="').concat(esc2(u.nickname || ""), '" placeholder="').concat(esc2(u.name), '" ').concat(canCard ? "" : "disabled", ">").concat(canManage ? '<label for="group-member-mute">禁言</label><select id="group-member-mute"><option value="">保持当前状态</option><option value="0">解除禁言</option><option value="10">10 分钟</option><option value="60">1 小时</option><option value="1440">1 天</option><option value="43200">30 天</option></select><p class="hint">'.concat(u.muteUntil > Date.now() ? "禁言至 " + esc2(new Date(u.muteUntil).toLocaleString()) : "当前未禁言", "</p>") : "").concat(g.role === "owner" && !self ? '<label class="prefs-row">设为管理员<input type="checkbox" id="group-member-admin" '.concat(u.role === "admin" ? "checked" : "", "></label>") : "").concat(canManage ? '<button class="group-danger" id="group-remove-member">移出群聊</button>' : ""), '<button class="secondary" data-group="members">返回成员列表</button>' + (canCard ? '<button class="primary" id="group-member-save">保存</button>' : ""));
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
      modal2("群管理", '<label for="group-edit-name">群名称</label><input id="group-edit-name" value="'.concat(esc2(c.name), '" maxlength="60"><label for="group-description">群介绍</label><textarea id="group-description" maxlength="200" placeholder="向搜索到群的人介绍一下">').concat(esc2(g.description), '</textarea><label class="prefs-row">允许通过群号或名称搜索<input type="checkbox" id="group-discoverable" ').concat(g.discoverable ? "checked" : "", '></label><label for="group-join-mode">加群方式</label><select id="group-join-mode">').concat(Object.entries(modes).map(([v, t]) => '<option value="'.concat(v, '" ').concat(g.joinMode === v ? "selected" : "", ">").concat(t, "</option>")).join(""), '</select><label class="prefs-row">允许成员邀请好友<input type="checkbox" id="group-members-invite" ').concat(g.membersInvite ? "checked" : "", '></label><label class="prefs-row">全员禁言<input type="checkbox" id="group-all-muted" ').concat(g.allMuted ? "checked" : "", '></label><p class="hint">全员禁言时，群主和管理员仍可发言。需审核的群，普通成员邀请好友也需要审核。</p>').concat(row("设置管理员", "在成员资料中设置，最多 10 人", "members")).concat(g.role === "owner" ? row("转让群主", "", "transfer") : ""), '<button class="secondary" data-group="back">返回</button><button class="primary" id="group-manage-save">保存</button>', true);
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
      modal2("邀请好友入群", '<p class="hint">'.concat(manager(c.group) || c.group.joinMode === "open" ? "选择好友加入群聊" : "邀请会提交给群主和管理员审核", '</p><div class="member-select">').concat(list.map((u) => '<label class="check-row">'.concat(av2(u)).concat(esc2(u.name), '<input type="checkbox" name="group-invite" value="').concat(u.id, '"></label>')).join("") || '<p class="hint">好友都已在群里</p>', "</div>"), '<button class="secondary" data-group="back">取消</button><button class="primary" id="group-invite-send">邀请</button>');
      bind("group-invite-send", async () => {
        const result = await action2("/api/conversations/" + c.id + "/members", { members: [...document.querySelectorAll("[name=group-invite]:checked")].map((x) => x.value) });
        toast2(result.pending ? "邀请已提交，等待审核" : "好友已加入");
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
          list.innerHTML = results.map((g) => '<article class="group-search-result">'.concat(av2({ kind: "group", avatar: "group" }), "<div><b>").concat(esc2(g.name), "</b><p>群号 ").concat(esc2(g.number), " · ").concat(g.count, ' 人</p><p class="hint">').concat(esc2(g.description), "</p><small>").concat(modes[g.joinMode], '</small></div><button class="').concat(g.joined ? "secondary" : "primary", '" data-group-join="').concat(g.id, '" data-joined="').concat(g.joined, '" data-name="').concat(esc2(g.name), '" ').concat(!g.joined && g.joinMode === "closed" ? "disabled" : "", ">").concat(g.joined ? "发消息" : "加入", "</button></article>")).join("") || '<p class="hint">没有找到群聊</p>';
        } catch (e2) {
          if (request === requestVersion && document.contains(list)) list.textContent = e2.message;
        }
      };
      $2("#group-search-query").focus();
    }
    function join(button) {
      const cid = button.dataset.groupJoin;
      if (button.dataset.joined === "true") {
        closeModal2();
        selectConversation2(cid);
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
          join(b);
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
  function createMedia({ S: S2, api: api2, action: action2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc2, icon: icon2, fileURL: fileURL2, randomID: randomID2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, upload: upload2 }) {
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
    async function sendMedia(file, kind, metadata = {}, cid = S2.active) {
      if (!cid || !S2.user) return;
      if (file.size > 50 * 1024 * 1024) throw Error("文件不能超过 50 MB");
      const owner = S2.user.id, clientId = randomID2();
      let attachment;
      const deliver = async () => {
        var _a, _b;
        try {
          if (((_a = S2.user) == null ? void 0 : _a.id) !== owner) throw Error("登录账号已变化，请重新选择要发送的内容");
          if (!attachment) {
            const form = new FormData();
            form.append("conversationId", cid);
            form.append("file", file);
            form.append("mediaKind", kind);
            for (const [key, value] of Object.entries(metadata)) form.append(key, String(value));
            toast2(kind === "voice" ? "正在发送语音…" : "正在发送视频…");
            attachment = await api2("/api/files", { method: "POST", body: form });
          }
          if (((_b = S2.user) == null ? void 0 : _b.id) !== owner) throw Error("登录账号已变化，请重新选择要发送的内容");
          const m = await action2("/api/conversations/".concat(cid, "/messages"), { kind, attachmentId: attachment.id, text: "", clientId });
          if (S2.active === cid) {
            if (S2.historyMode) {
              S2.messages = await api2("/api/conversations/".concat(cid, "/messages"));
              S2.historyMode = false;
            } else if (!S2.messages.some((x) => x.id === m.id)) S2.messages.push(m);
            renderMessages2();
          }
          queueRefresh2();
          toast2("发送成功");
          return m;
        } catch (error) {
          error.retry = deliver;
          throw error;
        }
      };
      return deliver();
    }
    function showRetry(error) {
      if (!S2.user) {
        toast2(error.message);
        return;
      }
      modal2("发送未完成", '<p class="hint">'.concat(esc2(error.message), "。录音或视频暂时保留在本窗口，可以重试发送。</p>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="media-retry">重试发送</button>');
      $2("#media-retry").onclick = async (e) => {
        e.target.disabled = true;
        try {
          await error.retry();
          closeModal2();
        } catch (next) {
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
      const cid = S2.active;
      if (!cid) return;
      if (file.size > 50 * 1024 * 1024) {
        toast2("视频不能超过 50 MB");
        return;
      }
      const fallback = (error) => {
        modal2("无法直接发送视频", '<p class="hint">'.concat(esc2(error.message), "，可以作为普通文件发送给对方。</p>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="video-send-file">作为文件发送</button>');
        $2("#video-send-file").onclick = () => {
          closeModal2();
          if (S2.active === cid) upload2(file, true);
          else toast2("聊天已切换，请重新选择文件");
        };
      };
      let metadata;
      try {
        metadata = await videoMetadata(file);
      } catch (error) {
        fallback(error);
        return;
      }
      try {
        await sendMedia(file, "video", metadata, cid);
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
            modal2("发送视频", '<button class="remote-choice" id="video-from-gallery">' + icon2("folder") + '从相册选择</button><button class="remote-choice" id="video-from-camera">' + icon2("video") + '拍摄视频</button><p class="hint">支持 MP4、WebM，单个文件不超过 50 MB。</p>');
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
      const recent = S2.conversations.map((c) => {
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
      if (state.more) list.insertAdjacentHTML("beforeend", '<button class="history-more secondary">加载更早记录</button>');
      list.querySelectorAll("[data-history-id]").forEach((button) => button.onclick = () => jump(state.cid, button.dataset.historyId).catch((e) => toast2(e.message)));
      const more = list.querySelector(".history-more");
      if (more) more.onclick = () => load(true);
    }
    async function load(older = false) {
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
      const state = current = { cid: S2.active, items: [], more: false, revision: 0 };
      modal2("聊天记录", '<div class="history-search-box"><input id="history-search" maxlength="200" placeholder="搜索消息内容或文件名" aria-label="搜索聊天记录"></div><div class="history-filters"><label>消息类型<select id="history-kind"><option value="">全部消息</option value="text">文字</option><option value="image">图片</option><option value="voice">语音</option><option value="video">视频</option><option value="file">文件</option><option value="meeting">会议</option><option value="forward">聊天记录</option></select></label><label>发送人<select id="history-sender"><option value="">所有人</option></select></label><label>开始日期<input type="date" id="history-from"></label><label>结束日期<input type="date" id="history-to"></label></div><div id="history-results" class="history-results" aria-live="polite"></div>', "", true);
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
      modal2("账号与安全", '<div class="security-account">'.concat(icon2("shield"), "<div><b>").concat(esc2(S2.user.name), "</b><p>WeLink 号：").concat(esc2(S2.user.number), '</p></div></div><button class="utility-row security-option" data-security="devices">').concat(icon2("monitor"), '<div class="body"><b>登录设备</b><p>查看设备，退出不再使用的登录</p></div>').concat(icon2("chevron"), '</button><button class="utility-row security-option" data-security="password">').concat(icon2("shield"), '<div class="body"><b>修改密码</b><p>修改后其他设备需要重新登录</p></div>').concat(icon2("chevron"), "</button>"));
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
      el("app").innerHTML = '<main class="auth-shell">'.concat(windows2(), '<section class="auth-card qr-auth">').concat(logo2(), '<h2>扫码登录</h2><p class="subtitle">使用安卓 WeLink「扫一扫」</p><div class="qr-image" id="qr-image"><span>正在生成二维码…</span></div><p class="qr-status" id="qr-status">请在手机上登录你的 WeLink 账号</p><p class="qr-check" id="qr-check"></p><div class="auth-error" id="auth-error"></div><button class="primary" id="qr-refresh">刷新二维码</button><div class="auth-links"><button data-action="login">密码登录</button><button data-action="register">注册账号</button></div><p class="auth-consent">扫码后请在手机上确认<br>二维码 3 分钟内有效，仅可使用一次</p></section><small class="auth-footer">WeLink 0.1.0</small></main>');
      el("qr-refresh").onclick = open;
      try {
        const q = await action2("/api/auth/qr", { device: "WeLink Windows 客户端" });
        if (active !== current) {
          action2("/api/auth/qr/cancel", q).catch(() => {
          });
          return;
        }
        Object.assign(current, q);
        el("qr-image").innerHTML = '<img alt="WeLink 桌面登录二维码" src="'.concat(q.image, '">');
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
        el("qr-status").textContent = result.state === "scanned" ? "扫码成功，请在手机上确认" : result.state === "expired" ? "二维码已过期，请刷新" : result.state === "rejected" ? "手机已取消登录，请刷新" : "请使用安卓 WeLink 扫描二维码";
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
        toast2("请先在手机上登录 WeLink");
        return;
      }
      const match = /^welink:\/\/login\/([a-f0-9]{32})\?key=([a-f0-9]{64})$/.exec(String(payload));
      if (!match) {
        toast2("这不是 WeLink 登录二维码");
        return;
      }
      const request = { id: match[1], key: match[2] };
      try {
        const result = await action2("/api/auth/qr/scan", request);
        phonePending = request;
        modal2("登录 Windows 版 WeLink", '<div class="qr-confirm"><div class="qr-computer">'.concat(icon2("monitor"), "</div><h3>").concat(esc2(result.device), "</h3><p>将使用 ").concat(esc2(S2.user.name), " 登录</p><p>WeLink 号：").concat(esc2(S2.user.number), '</p><div class="qr-check">核对码 ').concat(esc2(result.checkCode), '</div><p class="hint">请核对电脑上的数字，只确认你正在操作的电脑。</p></div>'), '<button class="secondary" id="qr-phone-cancel">取消登录</button><button class="primary" id="qr-phone-confirm">确认登录</button>');
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
        else toast2("请在安卓 WeLink 中使用扫一扫");
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

  // internal/ui/src/meetings.js
  function createMeetings({ api: api2, action: action2, S: S2, modal: modal2, toast: toast2, esc: esc2, icon: icon2 }) {
    let room = null, pending = /* @__PURE__ */ new Map();
    const el = (id) => document.getElementById(id);
    const root = () => {
      let n = el("meeting-layer");
      if (!n) {
        n = document.createElement("div");
        n.id = "meeting-layer";
        document.body.append(n);
      }
      return n;
    };
    const grouped = (code) => String(code).replace(/(\d{3})(?=\d)/g, "$1 ");
    function send(message) {
      if ((room == null ? void 0 : room.ws.readyState) === 1) room.ws.send(JSON.stringify(message));
    }
    function state() {
      if (!(room == null ? void 0 : room.id)) return;
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
      const n = document.querySelector("#main-content");
      n.innerHTML = '<section class="utility meeting-home"><h2>会议</h2><p class="hint">和好友一起面对面交流，也可以分享屏幕。</p><div class="meeting-cards"><button data-action="meeting-create">'.concat(icon2("video"), '<b>发起会议</b><span>邀请好友或群成员</span></button><button data-action="meeting-join">').concat(icon2("plus"), '<b>加入会议</b><span>输入 9 位会议号</span></button></div><h3>正在进行</h3><div id="meeting-list">正在读取…</div></section>');
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
      modal2(mode === "audio" ? "发起语音通话" : "发起会议", '<label>会议名称</label><input id="meeting-title" maxlength="60" value="'.concat(esc2(mode === "audio" ? S2.user.name + "的语音通话" : S2.user.name + "的会议"), '"><p class="hint">').concat(cid ? "将邀请当前会话成员加入。" : "创建后可邀请好友，或分享会议号。", '最多 8 人，最长 2 小时。</p><label class="check-row"><input type="checkbox" id="meeting-mic" checked>入会时开启麦克风</label><label class="check-row"><input type="checkbox" id="meeting-camera" ').concat(mode === "video" ? "checked" : "", ">入会时开启摄像头</label>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-create-submit">立即开始</button>');
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
      modal2("加入会议", '<label>会议号</label><input id="meeting-code" inputmode="numeric" maxlength="11" placeholder="000 000 000" value="'.concat(esc2(code), '"><label class="check-row"><input type="checkbox" id="meeting-mic" checked>开启麦克风</label><label class="check-row"><input type="checkbox" id="meeting-camera">开启摄像头</label>'), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-join-submit">加入会议</button>');
      el("meeting-join-submit").onclick = async () => {
        const b = el("meeting-join-submit");
        b.disabled = true;
        try {
          await join(el("meeting-code").value.replace(/\s/g, ""), el("meeting-mic").checked, el("meeting-camera").checked);
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
    async function join(code, mic = false, cam = false, host = false) {
      var _a, _b, _c;
      if (!/^[1-9]\d{8}$/.test(code)) throw Error("请输入 9 位会议号");
      if (room) {
        show();
        return;
      }
      if ((_a = window.WeLinkAndroid) == null ? void 0 : _a.openMeeting) {
        window.WeLinkAndroid.openMeeting(code, S2.token, S2.user.name, host, mic, cam);
        (_b = document.querySelector("[data-action=close-modal]")) == null ? void 0 : _b.click();
        return;
      }
      const stream = await initialMedia(mic, cam), ws = new WebSocket("ws://".concat(location.host, "/api/meetings/").concat(code, "/ws"));
      room = { code, ws, stream, id: "", host: "", states: /* @__PURE__ */ new Map(), peers: /* @__PURE__ */ new Map(), tiles: /* @__PURE__ */ new Map(), screen: null, recording: null, ping: null, started: Date.now(), intentional: false };
      const active = room;
      renderRoom();
      (_c = document.querySelector("[data-action=close-modal]")) == null ? void 0 : _c.click();
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
    function renderRoom() {
      root().innerHTML = '<section class="meeting-room"><header class="meeting-top"><b>WeLink 会议</b><button id="meeting-copy" title="复制会议号">'.concat(grouped(room.code), " ").concat(icon2("copy"), '</button><span id="meeting-network">正在连接…</span><button id="meeting-minimize">').concat(icon2("minus"), '</button></header><div class="meeting-content"><div id="meeting-grid" class="meeting-grid"></div><aside class="meeting-members"><h3>成员 <span id="meeting-count"></span></h3><div id="meeting-members-list"></div><button class="secondary" id="meeting-invite">邀请好友</button><p class="meeting-record-indicator hidden" id="meeting-recording">● 主持人正在录制</p></aside></div><footer class="meeting-tools"><button id="meeting-audio">').concat(icon2("phone"), '<span>麦克风</span></button><button id="meeting-video">').concat(icon2("video"), '<span>摄像头</span></button><button id="meeting-share">').concat(icon2("monitor"), '<span>共享屏幕</span></button><button id="meeting-record">').concat(icon2("file"), '<span>录制</span></button><button id="meeting-fullscreen">').concat(icon2("maximize"), '<span>全屏</span></button><button id="meeting-leave" class="meeting-leave">离开会议</button><button id="meeting-end" class="meeting-end">结束会议</button></footer></section>');
      el("meeting-copy").onclick = () => {
        if (root().classList.contains("meeting-minimized")) {
          show();
          return;
        }
        navigator.clipboard.writeText(room.code).then(() => toast2("会议号已复制")).catch(() => toast2(room.code));
      };
      el("meeting-minimize").onclick = () => {
        root().classList.add("meeting-minimized");
        toast2("会议在后台继续，点击会议入口返回");
      };
      for (const [id, fn] of [["meeting-audio", () => toggle("audio")], ["meeting-video", () => toggle("video")], ["meeting-share", share], ["meeting-record", record]]) el(id).onclick = () => fn().catch((e) => toast2(e.message));
      el("meeting-fullscreen").onclick = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else el("meeting-layer").requestFullscreen().catch((e) => toast2(e.message));
      };
      el("meeting-invite").onclick = invite;
      el("meeting-leave").onclick = () => leave(false);
      el("meeting-end").onclick = () => leave(true);
      updateButtons();
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
        n.innerHTML = '<video autoplay playsinline></video><div class="meeting-person"></div><div class="meeting-tile-label"></div>';
        room.tiles.set(id, n);
        el("meeting-grid").append(n);
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
      n.querySelector(".meeting-person").textContent = (name || "W").slice(0, 1);
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
          n.classList.toggle("has-video", !!p.camera || !!p.screen);
          n.classList.toggle("is-screen", !!p.screen);
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
      const active = room, pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:www.yucg.cn:8233" }] }), entry = { id, pc, makingOffer: false, queue: [], ignore: false };
      room.peers.set(id, entry);
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
      pc.onconnectionstatechange = () => {
        if (room !== active) return;
        const failed = [...room.peers.values()].some((p) => p.pc.connectionState === "failed");
        el("meeting-network").textContent = failed ? "部分成员直连失败，请切换网络重试" : "会议进行中";
      };
      return entry;
    }
    async function offer(p) {
      if (!room || p.makingOffer || p.pc.signalingState !== "stable") return;
      try {
        p.makingOffer = true;
        await p.pc.setLocalDescription(await p.pc.createOffer());
        send({ type: "signal", to: p.id, signal: "offer", sdp: p.pc.localDescription.sdp });
      } finally {
        p.makingOffer = false;
      }
    }
    async function receive(m) {
      var _a, _b;
      if (!room) return;
      if (m.type === "welcome") {
        room.id = m.id;
        room.host = m.host;
        room.states.set(m.id, { name: S2.user.name });
        tile(m.id, S2.user.name, room.stream, true);
        for (const p2 of m.peers || []) {
          room.states.set(p2.id, p2);
          tile(p2.id, p2.name);
          await offer(peer(p2.id));
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
        (_a = room.peers.get(m.id)) == null ? void 0 : _a.pc.close();
        room.peers.delete(m.id);
        (_b = room.tiles.get(m.id)) == null ? void 0 : _b.remove();
        room.tiles.delete(m.id);
        room.states.delete(m.id);
        renderMembers();
        return;
      }
      if (m.type === "state") {
        const p2 = room.states.get(m.id);
        if (p2) Object.assign(p2, { microphone: !!m.microphone, camera: !!m.camera, screen: !!m.screen, recording: !!m.recording });
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
      if (m.type !== "signal") return;
      const p = peer(m.from), pc = p.pc;
      if (m.signal === "candidate") {
        const c = JSON.parse(m.candidate);
        if (pc.remoteDescription) await pc.addIceCandidate(c).catch((e) => {
          if (!p.ignore) throw e;
        });
        else p.queue.push(c);
        return;
      }
      const collision = m.signal === "offer" && (p.makingOffer || pc.signalingState !== "stable"), polite = room.id > m.from;
      p.ignore = !polite && collision;
      if (p.ignore) return;
      if (collision) await pc.setLocalDescription({ type: "rollback" });
      await pc.setRemoteDescription({ type: m.signal, sdp: m.sdp });
      for (const c of p.queue.splice(0)) await pc.addIceCandidate(c);
      if (m.signal === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        send({ type: "signal", to: m.from, signal: "answer", sdp: pc.localDescription.sdp });
      }
    }
    async function toggle(kind) {
      if (!room) return;
      const tracks = kind === "audio" ? room.stream.getAudioTracks() : room.stream.getVideoTracks();
      if (tracks.length) tracks.forEach((t) => t.enabled = !t.enabled);
      else {
        const stream = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio: { echoCancellation: true } } : { video: true });
        for (const t of stream.getTracks()) {
          room.stream.addTrack(t);
          for (const p of room.peers.values()) {
            if (kind === "video" && room.screen) continue;
            const sender = p.pc.getSenders().find((s) => {
              var _a;
              return ((_a = s.track) == null ? void 0 : _a.kind) === kind;
            });
            if (sender) await sender.replaceTrack(t);
            else p.pc.addTrack(t, room.stream);
          }
        }
      }
      if (!room.screen) tile(room.id, S2.user.name, room.stream, true);
      state();
    }
    async function replaceVideo(track, stream) {
      for (const p of room.peers.values()) {
        const sender = p.pc.getSenders().find((s) => {
          var _a;
          return ((_a = s.track) == null ? void 0 : _a.kind) === "video";
        });
        if (sender) await sender.replaceTrack(track);
        else if (track) p.pc.addTrack(track, stream);
      }
    }
    async function share() {
      var _a;
      if (!room || room.id !== room.host) return;
      if (room.screen) {
        await stopSharing();
        return;
      }
      if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getDisplayMedia)) throw Error("当前系统不支持屏幕共享");
      const active = room, screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 20 } }, audio: false });
      if (room !== active) {
        screen.getTracks().forEach((t) => t.stop());
        return;
      }
      room.screen = screen;
      screen.getVideoTracks()[0].onended = () => stopSharing();
      await replaceVideo(screen.getVideoTracks()[0], screen);
      tile(room.id, S2.user.name, screen, true);
      state();
    }
    async function stopSharing() {
      if (!(room == null ? void 0 : room.screen)) return;
      const screen = room.screen;
      room.screen = null;
      screen.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      await replaceVideo(room.stream.getVideoTracks()[0] || null, room.stream);
      tile(room.id, S2.user.name, room.stream, true);
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
        a.download = "WeLink-会议-".concat(capture.code, "-").concat(Date.now(), ".webm");
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
      if (!room) return;
      modal2("邀请好友入会", '<p class="hint">会议号：'.concat(grouped(room.code), '</p><div class="member-select">').concat(S2.friends.map((u) => '<label class="check-row">'.concat(esc2(u.name), '<input type="checkbox" value="').concat(u.id, '" name="meeting-invite-user"></label>')).join("") || '<p class="hint">还没有好友，可以复制会议号分享。</p>', "</div>"), '<button class="primary" id="meeting-send-invites">发送邀请</button>');
      el("meeting-send-invites").onclick = async () => {
        try {
          await action2("/api/meetings/".concat(room.code, "/invite"), { members: [...document.querySelectorAll("[name=meeting-invite-user]:checked")].map((x) => x.value) });
          document.querySelector("[data-action=close-modal]").click();
          toast2("会议邀请已发送");
        } catch (e) {
          toast2(e.message);
        }
      };
    }
    function invited(m) {
      pending.set(m.code, m);
      toast2("".concat(m.title, "：收到会议邀请"));
      modal2("会议邀请", '<div class="remote-invite"><h3>'.concat(esc2(m.title), "</h3><p>会议号 ").concat(grouped(m.code), "</p></div>"), '<button class="secondary" data-action="close-modal">暂不加入</button><button class="primary" id="meeting-accept">加入会议</button>');
      el("meeting-accept").onclick = () => openJoin(m.code);
    }
    function leave(end) {
      if (!room) return;
      modal2(end ? "结束会议" : "离开会议", '<p class="hint">'.concat(end ? "结束后所有成员将离开，会议号立即失效。" : "会议中的其他成员可以继续交流。", "</p>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-confirm-leave">确认</button>');
      el("meeting-confirm-leave").onclick = async () => {
        var _a;
        const active = room;
        try {
          if (end) await action2("/api/meetings/".concat(active.code, "/end"));
          active.intentional = true;
          cleanup(active);
          (_a = document.querySelector("[data-action=close-modal]")) == null ? void 0 : _a.click();
        } catch (e) {
          toast2(e.message);
        }
      };
    }
    function cleanup(active) {
      var _a;
      if (room === active) {
        stopRecording();
        room = null;
      }
      clearInterval(active.ping);
      active.ws.close();
      for (const p of active.peers.values()) p.pc.close();
      active.stream.getTracks().forEach((t) => t.stop());
      (_a = active.screen) == null ? void 0 : _a.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      root().innerHTML = "";
      root().classList.remove("meeting-minimized");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {
      });
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
    return { renderHome, openCreate, openJoin, invited, show, close: () => {
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
  var paths = { chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 2v-6.5A8.5 8.5 0 1 1 21 11.5ZM8 11h.01M12 11h.01M16 11h.01", contacts: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87", folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18", star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z", monitor: "M3 4h18v13H3ZM8 21h8M12 17v4", settings: "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0", search: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.5-2 5 5", plus: "M12 5v14M5 12h14", more: "M5 12h.01M12 12h.01M19 12h.01", close: "m6 6 12 12M18 6 6 18", minus: "M5 12h14", maximize: "M5 5h14v14H5Z", chevron: "m9 5 7 7-7 7", back: "m15 5-7 7 7 7", down: "m5 9 7 7 7-7", emoji: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 9h.01M16 9h.01M7 14c2 4 8 4 10 0", image: "M3 3h18v18H3ZM3 16l5-5 5 5 3-3 5 5M15 7h.01", file: "M14 2H5v20h14V7ZM14 2v6h5M8 13h8M8 17h6", scissors: "M6 14a4 4 0 1 1-4 4 4 4 0 0 1 4-4ZM6 2a4 4 0 1 1-4 4 4 4 0 0 1 4-4Zm3 7 12 12M9 15 21 3", history: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2", phone: "M4 3h4l2 5-3 2c1 3 4 6 7 7l2-3 5 2v4c-9 3-20-8-17-17Z", video: "M3 5h12v14H3ZM15 9l6-3v12l-6-3", reply: "m9 5-6 6 6 6M3 11h10c5 0 8 3 8 8", trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7", check: "m4 12 5 5L20 6", bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4", mute: "M9 5a6 6 0 0 1 9 5c0 3 1 5 3 7H8M3 3l18 18M6 8c0 6-3 7-3 9h3", pin: "m8 3 8 0-1 7 4 4H5l4-4ZM12 14v8", download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5", logout: "M9 4H4v16h5M9 12h12m-4-4 4 4-4 4", user: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 22v-2a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7v2", shield: "m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6ZM8 12l3 3 5-6", send: "m3 3 19 9-19 9 4-9ZM7 12h15", copy: "M8 8h13v13H8ZM16 8V3H3v13h5", refresh: "M3 11a9 9 0 0 1 15-7l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 7l-3-3M3 21v-5h5", info: "M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" };
  var icon = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'.concat(paths[n] || paths.chat, '"/></svg>');
  var btn = (name, title, action2, extra = "") => '<button class="icon-btn" title="'.concat(title, '" aria-label="').concat(title, '" data-action="').concat(action2, '" ').concat(extra, ">").concat(icon(name), "</button>");
  var av = (u = {}, size = "", online = false) => '<span class="avatar '.concat(esc(u.avatar || "blue"), " ").concat(size, '">').concat(u.kind === "group" ? icon("contacts") : esc((u.name || "W").slice(0, 1))).concat(online && u.online ? '<i class="dot"></i>' : "", "</span>");
  var logo = () => '<div class="logo"><img src="/assets/icon.svg" alt=""><b>WeLink</b></div>';
  var S = { token: localStorage.getItem("welink_token") || "", user: null, config: {}, tab: "messages", contactTab: "friends", conversations: [], friends: [], requests: [], groupRequests: [], messages: [], active: null, profile: null, search: "", historyMode: false, reply: null, drafts: {}, ws: null, offline: false, remote: null, remoteTimer: null, remoteLocal: null };
  var modalHandler = null;
  var refreshTimer = null;
  var toastTimer;
  var searchTimer;
  var typingAt = 0;
  function toast(msg) {
    const n = document.createElement("div");
    n.className = "toast";
    n.textContent = msg;
    $("#toasts").append(n);
    setTimeout(() => n.remove(), 3800);
  }
  async function api(path, options = {}) {
    const headers = __spreadValues({}, options.headers);
    if (S.token) headers.Authorization = "Bearer " + S.token;
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    ;
    const r = await fetch(path, __spreadProps(__spreadValues({}, options), { headers }));
    if (r.status === 401 && S.user && !path.startsWith("/local")) {
      logout(false);
      throw Error("登录已过期，请重新登录");
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
  function modal(title, body, footer = "", wide = false) {
    var _a;
    (_a = window.WeLinkMediaBeforeModal) == null ? void 0 : _a.call(window);
    $("#overlays").innerHTML = '<div class="modal-backdrop"><section class="modal '.concat(wide ? "wide" : "", '" role="dialog" aria-modal="true" aria-label="').concat(esc(title), '"><header class="modal-head"><h3>').concat(esc(title), "</h3>").concat(btn("close", "关闭", "close-modal"), '</header><div class="modal-body">').concat(body, '<div class="form-error" id="modal-error"></div></div>').concat(footer ? '<footer class="modal-footer">'.concat(footer, "</footer>") : "", "</section></div>");
    modalHandler = null;
    setTimeout(() => {
      var _a2;
      return (_a2 = $(".modal input:not([type=checkbox])")) == null ? void 0 : _a2.focus();
    }, 40);
  }
  var modalError = (e) => {
    $("#modal-error") ? $("#modal-error").textContent = e.message : toast(e.message);
  };
  function closeModal() {
    $("#overlays").innerHTML = "";
    modalHandler = null;
  }
  function windows() {
    return '<div class="window-controls">'.concat(btn("minus", "最小化", "window-min")).concat(btn("maximize", "最大化", "window-max")).concat(btn("close", "关闭", "window-close"), "</div>");
  }
  function renderAuth(register = false) {
    QR.stop();
    S.user = null;
    $("#app").innerHTML = '<main class="auth-shell">'.concat(windows(), '<form class="auth-card" id="auth-form">').concat(logo(), "<h2>").concat(register ? "创建 WeLink 账号" : "欢迎回来", '</h2><p class="subtitle">').concat(register ? "新的相遇，从这里开始" : "和在意的人，随时保持联系", '</p><div class="auth-fields">').concat(register ? '<input name="name" autocomplete="nickname" placeholder="昵称" aria-label="昵称" maxlength="32" required>' : "", '<input name="account" autocomplete="username" placeholder="').concat(register ? "登录别名（可选）" : "WeLink 号码 / 登录别名", '" aria-label="账号" minlength="5" maxlength="24" ').concat(register ? "" : "required", '><input name="password" type="password" autocomplete="').concat(register ? "new-password" : "current-password", '" placeholder="').concat(register ? "设置密码（至少 8 位）" : "密码", '" aria-label="密码" minlength="8" maxlength="72" required></div><div class="auth-error" id="auth-error"></div><button type="submit" class="primary">').concat(register ? "注册并登录" : "登录", "</button>").concat(!register && S.config.platform !== "android" ? '<button type="button" class="qr-login-entry" data-action="qr-login">使用二维码登录</button>' : "", '<div class="auth-links"><button type="button" data-action="').concat(register ? "login" : "register", '">').concat(register ? "已有账号，去登录" : "注册账号", '</button><button type="button" data-action="connection">连接设置</button></div><p class="auth-consent">WeLink 独立账号 · 密码加密保存<br>登录后即可使用消息、文件与远程协助</p></form><small class="auth-footer">WeLink 0.1.0 · 让沟通更近一步</small></main>');
    $("#auth-form").onsubmit = async (e) => {
      e.preventDefault();
      const submit = $("button[type=submit]", e.target);
      submit.disabled = true;
      $("#auth-error").textContent = "";
      try {
        const p = [...new FormData(e.target)].reduce((p2, [k, v]) => (p2[k] = v, p2), {});
        const result = await action("/api/auth/" + (register ? "register" : "login"), p);
        S.token = result.token;
        localStorage.setItem("welink_token", S.token);
        S.user = result.user;
        await enter();
        if (register) modal("注册成功", '<p class="hint">请记住你的 WeLink 号码，可用于登录和添加好友。</p><div class="welink-number">'.concat(esc(S.user.number), "</div>"), '<button class="primary" data-action="close-modal">开始使用</button>');
      } catch (err) {
        $("#auth-error").textContent = err.message;
        submit.disabled = false;
      }
    };
  }
  function nav() {
    const unread = S.conversations.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0), requests = S.requests.filter((q) => q.recipient === S.user.id && q.status === "pending").length + S.groupRequests.filter((q) => q.canReview && q.status === "pending").length;
    return '<aside class="rail"><button class="self" title="个人资料" data-action="profile">'.concat(av(S.user, "", true), "</button><nav>").concat([["messages", "chat", "消息", unread], ["contacts", "contacts", "联系人", requests], ["meetings", "video", "会议", 0], ["remote", "monitor", "远程协助", 0], ["files", "folder", "文件", 0], ["favorites", "star", "收藏", 0], ["profile", "user", "我的", 0]].map(([tab, i, t, n]) => '<button data-nav="'.concat(tab, '" class="').concat(S.tab === tab ? "active" : "", '" title="').concat(t, '" aria-label="').concat(t, '">').concat(icon(i), '<span class="rail-label">').concat(t === "远程协助" ? "远程" : t, "</span>").concat(n ? '<span class="badge">'.concat(n > 99 ? "99+" : n, "</span>") : "", "</button>")).join(""), '</nav><div class="rail-bottom">').concat(btn("settings", "设置", "settings")).concat(btn("more", "更多", "more-menu"), "</div></aside>");
  }
  function renderShell() {
    const utility = !["messages", "contacts"].includes(S.tab);
    $("#app").innerHTML = '<div class="shell '.concat(S.active && S.tab === "messages" ? "in-chat" : "", " ").concat(utility ? "in-utility" : "", '">').concat(nav(), '<aside class="sidebar"><div class="mobile-title"><button data-action="profile">').concat(av(S.user), "</button><h2>").concat(S.tab === "contacts" ? "联系人" : "消息", "</h2>").concat(btn("plus", "添加好友或群聊", "add-menu"), '</div><div class="searchbar"><label class="searchbox">').concat(icon("search"), '<input id="sidebar-search" value="').concat(esc(S.search), '" placeholder="搜索" aria-label="搜索会话或联系人"></label>').concat(btn("plus", "添加好友或群聊", "add-menu"), '</div><div id="sidebar-content" class="list-scroll"></div></aside><main class="main">').concat(windows(), '<div id="connection-status"></div><div id="main-content" style="display:contents"></div></main></div>');
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
    if (S.tab === "contacts") {
      const pending = S.requests.filter((q) => q.recipient === S.user.id && q.status === "pending").length;
      list.innerHTML = '<button class="notify-row" data-action="requests">'.concat(icon("bell"), "好友通知").concat(pending ? '<span class="badge">'.concat(pending, "</span>") : "", '</button><button class="notify-row group-notice-row" data-group="requests">').concat(icon("contacts"), "群通知").concat(S.groupRequests.some((q) => q.canReview && q.status === "pending") ? '<span class="badge">' + S.groupRequests.filter((q) => q.canReview && q.status === "pending").length + "</span>" : "", '</button><div class="contact-tab"><button data-contact-tab="friends" class="').concat(S.contactTab === "friends" ? "active" : "", '">好友</button><button data-contact-tab="groups" class="').concat(S.contactTab === "groups" ? "active" : "", '">群聊</button></div>').concat(S.contactTab === "friends" ? '<div class="contact-group">'.concat(icon("down"), '我的好友 <span class="muted">').concat(S.friends.length, "</span></div>").concat(S.friends.filter((u) => "".concat(u.name).concat(u.account).concat(u.number).toLowerCase().includes(S.search.toLowerCase())).map((u) => '<button class="conversation-row contact-row" data-profile="'.concat(u.id, '">').concat(av(u, "", true), '<div class="row-text"><div class="row-title"><b>').concat(esc(u.remark || u.name), '</b></div><div class="row-preview"><span>').concat(esc(u.bio || (u.online ? "[在线]" : "[离线]")), "</span></div></div></button>")).join("") || '<div class="empty-list">还没有好友<br>添加好友，开始新的聊天</div>') : S.conversations.filter((c) => {
        var _a;
        return c.kind === "group" && (c.name + (((_a = c.group) == null ? void 0 : _a.number) || "")).toLowerCase().includes(S.search.toLowerCase());
      }).map(conversationRow).join("") || '<div class="empty-list">还没有群聊</div>');
      return;
    }
    ;
    const result = S.conversations.filter((c) => {
      var _a, _b;
      return "".concat(c.name).concat(((_a = c.group) == null ? void 0 : _a.number) || "").concat(((_b = c.last) == null ? void 0 : _b.text) || "").toLowerCase().includes(S.search.toLowerCase());
    });
    list.innerHTML = result.map(conversationRow).join("") || '<div class="empty-list">'.concat(S.search ? "没有找到相关会话" : "暂无消息<br>添加好友后，消息会出现在这里", "</div>").concat(S.search ? "" : '<button class="search-action" data-action="add-friend">＋ 添加好友</button>');
  }
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
  function conversationRow(c) {
    return '<button class="conversation-row '.concat(S.active === c.id ? "selected" : "", " ").concat(c.pinned ? "pinned" : "", '" data-conversation="').concat(c.id, '">').concat(av(c.kind === "group" ? { name: c.name, kind: "group", avatar: "group" } : c.peer || c), '<div class="row-text"><div class="row-title"><b>').concat(esc(c.name), "</b><time>").concat(c.last ? shortTime(c.last.created) : "", '</time></div><div class="row-preview"><span>').concat(esc(c.kind === "group" && c.last && !c.last.recalled ? "".concat(c.last.name, "：") : "")).concat(esc(preview(c.last)), "</span>").concat(c.muted ? icon("mute") : "").concat(c.unread ? '<i class="badge">'.concat(c.unread > 99 ? "99+" : c.unread, "</i>") : "", "</div></div></button>");
  }
  function activeConversation() {
    return S.conversations.find((c) => c.id === S.active);
  }
  function renderMain() {
    var _a, _b;
    const main = $("#main-content");
    if (!main) return;
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
    if (S.tab === "remote") {
      renderRemoteHome();
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
      main.innerHTML = empty("WeLink", "每一句，都有回应。", true);
      return;
    }
    ;
    main.innerHTML = '<header class="chat-head">'.concat(btn("back", "返回", "back", "").replace('class="icon-btn"', 'class="icon-btn mobile-back"'), "<h2>").concat(esc(c.name), '<small id="typing-status">').concat(c.kind === "direct" ? ((_a = c.peer) == null ? void 0 : _a.online) ? "在线" : "离线" : "群聊", '</small></h2><div class="chat-actions">').concat(btn("phone", "语音通话", "meeting-audio-call")).concat(btn("video", "发起会议", "meeting-start")).concat(btn("monitor", "远程协助", "remote")).concat(btn("search", "搜索聊天记录", "search-history")).concat(btn("more", "聊天设置", "chat-detail"), '</div></header><div id="sharing-banner"></div><section class="message-area" id="messages" aria-label="聊天记录"></section><section class="composer" aria-label="消息输入"><div class="reply-draft hidden" id="reply-draft"></div><div class="compose-tools">').concat(Media.tools()).concat(btn("emoji", "表情", "emoji")).concat(btn("image", "发送图片", "image"), '<button class="icon-btn" title="发送视频" aria-label="发送视频" data-media="video">').concat(icon("video"), "</button>").concat(btn("folder", "发送文件", "file")).concat(btn("scissors", "截图", "screenshot")).concat(btn("monitor", "远程协助", "remote"), '<span class="spacer"></span><button class="history-btn" data-action="search-history">').concat(icon("history"), '聊天记录</button></div><textarea id="composer" placeholder="" aria-label="输入消息" maxlength="6000">').concat(esc(S.drafts[c.id] || ""), "</textarea>").concat(Media.input(), '<div class="compose-bottom"><small>Enter 发送，Shift + Enter 换行</small><button class="send-btn" id="send-message" data-action="send" ').concat(((_b = S.drafts[c.id]) == null ? void 0 : _b.trim()) ? "" : "disabled", '>发送</button></div><input type="file" id="image-input" class="file-input" accept="image/png,image/jpeg,image/gif,image/webp"><input type="file" id="file-input" class="file-input"></section>');
    renderMessages();
    const input = $("#composer");
    input.oninput = () => {
      var _a2;
      S.drafts[S.active] = input.value;
      $("#send-message").disabled = !input.value.trim();
      if (Date.now() - typingAt > 2500 && ((_a2 = S.ws) == null ? void 0 : _a2.readyState) === 1) {
        typingAt = Date.now();
        S.ws.send(JSON.stringify({ type: "typing", conversationId: S.active }));
      }
    };
    input.onkeydown = (e) => {
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
    area.ondragover = (e) => {
      e.preventDefault();
    };
    area.ondrop = (e) => {
      e.preventDefault();
      if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
    };
    renderReply();
    renderSharing();
    Media.mount();
    Groups.syncComposer();
  }
  function empty(title, sub, add = false) {
    return '<div class="empty-chat"><img src="/assets/icon.svg" alt=""><h2>'.concat(title, "</h2><p>").concat(sub, "</p>").concat(add ? '<button class="primary" data-action="add-friend">添加好友</button>' : "", "</div>");
  }
  function fileURL(id) {
    return "/api/files/" + encodeURIComponent(id);
  }
  function messageHTML(m) {
    var _a;
    if (m.recalled) return '<div class="recalled" data-message="'.concat(m.id, '">').concat(Forwarding.checkbox(m)).concat(m.sender === S.user.id ? "你" : esc(m.name), "撤回了一条消息</div>");
    const mine = m.sender === S.user.id;
    const quote = S.messages.find((x) => x.id === m.replyId) || m.reply;
    let content = esc(m.text);
    if (m.kind === "voice" || m.kind === "video") content = Media.bubble(m);
    if (m.kind === "forward") content = Forwarding.card(m);
    if (m.kind === "meeting") {
      try {
        const meeting = JSON.parse(m.text);
        content = '<button class="file-card" data-meeting-code="'.concat(esc(meeting.code), '">').concat(icon("video"), "<span><b>").concat(esc(meeting.title), "</b><small>会议号 ").concat(esc(meeting.code), " · 点击加入</small></span></button>");
      } catch (e) {
      }
    }
    if (m.kind === "image") content = '<img src="'.concat(fileURL(m.attachmentId), '" alt="').concat(esc(m.fileName || "图片"), '" loading="lazy" data-preview-image="').concat(m.attachmentId, '">');
    if (m.kind === "file") content = '<button class="file-card" data-download="'.concat(m.attachmentId, '" data-filename="').concat(esc(m.fileName), '">').concat(icon("file"), "<span><b>").concat(esc(m.fileName), "</b><small>").concat(bytes(m.fileSize), " · 点击下载</small></span></button>");
    return '<article class="message '.concat(mine ? "mine" : "", '" data-message="').concat(m.id, '">').concat(Forwarding.checkbox(m)).concat(av(m), '<div class="message-body">').concat(((_a = activeConversation()) == null ? void 0 : _a.kind) === "group" && !mine ? '<span class="message-name">'.concat(esc(m.name), "</span>") : "", '<div class="bubble ').concat(m.kind === "image" ? "image-bubble" : m.kind === "forward" ? "forward-bubble" : m.kind === "voice" ? "voice-bubble" : m.kind === "video" ? "video-bubble" : "", '">').concat(content, "</div>").concat(m.replyId ? '<button class="quote" data-action="jump-message" data-mid="'.concat(m.replyId, '" title="查看原消息">').concat(quote ? esc(quote.name + "：" + preview(quote)) : "原消息不可用", "</button>") : "", '<span class="message-time">').concat(shortTime(m.created), '</span></div><div class="message-menu"><button class="icon-btn" title="转发" aria-label="转发" data-fw="single" data-mid="').concat(m.id, '">').concat(icon("send"), "</button>").concat(btn("reply", "引用", "quote", 'data-mid="'.concat(m.id, '"'))).concat(btn("star", "收藏", "favorite", 'data-mid="'.concat(m.id, '"'))).concat(mine && Date.now() - m.created < 12e4 ? btn("history", "撤回", "recall", 'data-mid="'.concat(m.id, '"')) : "").concat(btn("trash", "删除", "delete-message", 'data-mid="'.concat(m.id, '"')), "</div></article>");
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
    if (!S.messages.length) area.innerHTML = '<div class="timestamp">和好友打个招呼吧</div>';
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
    Media.reset();
    Forwarding.reset(false);
    S.active = id;
    S.historyMode = false;
    S.tab = "messages";
    S.reply = null;
    S.messages = [];
    S.profile = null;
    S.search = "";
    renderShell();
    try {
      const m = await api("/api/conversations/".concat(id, "/messages"));
      if (S.active !== id) return;
      S.messages = m;
      renderMessages();
      await markRead();
      if (innerWidth > 700) (_a = $("#composer")) == null ? void 0 : _a.focus();
    } catch (e) {
      toast(e.message);
    }
  }
  async function markRead() {
    const last = S.messages[S.messages.length - 1];
    if (!last || document.hidden || S.historyMode) return;
    await action("/api/conversations/".concat(S.active, "/read"), { seq: last.seq });
    const c = activeConversation();
    if (c) c.unread = 0;
    renderSidebar();
    updateRail();
  }
  function updateRail() {
    const old = $(".rail");
    if (old) old.outerHTML = nav();
  }
  async function sendMessage() {
    const input = $("#composer");
    if (!(input == null ? void 0 : input.value.trim()) || input.disabled) return;
    const text = input.value, cid = S.active, reply = S.reply;
    const clientId = randomID();
    input.disabled = true;
    try {
      const m = await action("/api/conversations/".concat(cid, "/messages"), { kind: "text", text, replyId: (reply == null ? void 0 : reply.id) || "", clientId });
      S.drafts[cid] = "";
      if (S.active === cid) {
        if (S.historyMode) {
          S.messages = await api("/api/conversations/".concat(cid, "/messages"));
          S.historyMode = false;
        }
        input.value = "";
        $("#send-message").disabled = true;
        S.reply = null;
        renderReply();
        if (!S.messages.some((x) => x.id === m.id)) S.messages.push(m);
        renderMessages();
        markRead().catch(() => {
        });
      }
      queueRefresh();
    } catch (e) {
      toast(e.message);
    } finally {
      input.disabled = false;
      input.focus();
    }
  }
  function renderReply() {
    const d = $("#reply-draft");
    if (!d) return;
    d.classList.toggle("hidden", !S.reply);
    d.closest(".composer").classList.toggle("has-reply", !!S.reply);
    d.innerHTML = S.reply ? "<span>回复 ".concat(esc(S.reply.name), "：").concat(esc(preview(S.reply)), "</span>").concat(btn("close", "取消引用", "cancel-reply")) : "";
  }
  async function upload(file, forceFile = false) {
    if (!forceFile && (/^video\//.test(file.type) || /\.(mp4|webm|m4v)$/i.test(file.name))) {
      await Media.sendVideo(file);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast("文件不能超过 50 MB");
      return;
    }
    const cid = S.active;
    if (!cid) return;
    const form = new FormData();
    form.append("conversationId", cid);
    form.append("file", file);
    toast("正在上传 " + file.name);
    try {
      const f = await api("/api/files", { method: "POST", body: form });
      const m = await action("/api/conversations/".concat(cid, "/messages"), { kind: /^image\/(png|jpeg|gif|webp)$/.test(f.mime) ? "image" : "file", attachmentId: f.id, text: "", clientId: randomID() });
      if (S.active === cid) {
        if (S.historyMode) {
          S.messages = await api("/api/conversations/".concat(cid, "/messages"));
          S.historyMode = false;
        } else if (!S.messages.some((x) => x.id === m.id)) S.messages.push(m);
        renderMessages();
      }
      queueRefresh();
      toast("发送成功");
    } catch (e) {
      toast(e.message);
    }
  }
  function bytes(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.ceil(n / 1024) + " KB" : n + " B";
  }
  async function refresh() {
    var _a, _b;
    if (!S.user) return;
    const userId = S.user.id;
    const [conversations, friends, requests, groupRequests] = await Promise.all([api("/api/conversations"), api("/api/friends"), api("/api/requests"), api("/api/group-requests")]);
    if (((_a = S.user) == null ? void 0 : _a.id) !== userId) return;
    S.conversations = conversations;
    S.friends = friends;
    S.requests = requests;
    S.groupRequests = groupRequests;
    if (S.active && !conversations.some((c2) => c2.id === S.active)) {
      Media.reset();
      Forwarding.reset(false);
      S.active = null;
      S.messages = [];
      S.reply = null;
      closeModal();
      renderShell();
      toast("你已退出该群或群已解散");
    }
    renderSidebar();
    updateRail();
    const c = activeConversation();
    if (c && $("#typing-status")) $("#typing-status").textContent = c.kind === "direct" ? ((_b = c.peer) == null ? void 0 : _b.online) ? "在线" : "离线" : "群聊";
    Groups.syncComposer();
  }
  function queueRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch((e) => toast(e.message)), 200);
  }
  async function enter() {
    await refresh();
    renderShell();
    connectEvents();
  }
  function connectEvents() {
    var _a;
    if (!S.user) return;
    (_a = S.ws) == null ? void 0 : _a.close();
    const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/ws");
    S.ws = ws;
    ws.onopen = () => {
      S.offline = false;
      connectionState();
      refresh().catch(() => {
      });
      if (S.active && !S.historyMode) {
        const cid = S.active;
        api("/api/conversations/".concat(cid, "/messages")).then((ms) => {
          if (S.active !== cid || S.historyMode) return;
          S.messages = ms;
          renderMessages(true);
          markRead().catch(() => {
          });
        }).catch(() => {
        });
      }
    };
    ws.onmessage = (e) => {
      var _a2;
      let event;
      try {
        event = JSON.parse(e.data);
      } catch (e2) {
        return;
      }
      const d = event.data;
      if (event.type === "message") {
        if (S.active === d.conversationId && !S.historyMode) {
          if (!S.messages.some((m) => m.id === d.id)) S.messages.push(d);
          renderMessages(true);
          markRead().catch(() => {
          });
        } else if (S.active !== d.conversationId && d.sender !== S.user.id && !((_a2 = S.conversations.find((c) => c.id === d.conversationId)) == null ? void 0 : _a2.muted)) {
          if (document.hidden && Notification.permission === "granted") new Notification(d.name, { body: preview(d), icon: "/assets/icon.svg" });
          document.title = "新消息 · WeLink";
        }
        queueRefresh();
      } else if (event.type === "recall") {
        applyRecall(d);
      } else if (event.type === "message-deleted") {
        applyDeletion(d);
      } else if (event.type === "typing") {
        if (d.conversationId === S.active && d.userId !== S.user.id && $("#typing-status")) {
          $("#typing-status").textContent = "对方正在输入…";
          setTimeout(() => {
            var _a3, _b;
            if ($("#typing-status")) $("#typing-status").textContent = ((_b = (_a3 = activeConversation()) == null ? void 0 : _a3.peer) == null ? void 0 : _b.online) ? "在线" : "";
          }, 3200);
        }
      } else if (event.type === "meeting-invite") {
        Meetings.invited(d);
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
    const n = $("#connection-status");
    if (n) n.innerHTML = S.offline ? '<div class="connection-state">网络连接已断开，正在重新连接…</div>' : "";
  }
  async function logout(notify = true) {
    if (S.signingOut) return;
    Media.reset();
    Forwarding.reset(false);
    S.signingOut = true;
    try {
      Meetings.close();
      if (notify) try {
        await action("/api/auth/logout");
      } catch (e) {
      }
      S.user = null;
      const ws = S.ws;
      S.ws = null;
      ws == null ? void 0 : ws.close();
      S.token = "";
      localStorage.removeItem("welink_token");
      S.active = null;
      S.messages = [];
      closeModal();
      stopRemote(false).catch(() => {
      });
      renderAuth();
    } finally {
      S.signingOut = false;
    }
  }
  function addFriend() {
    modal("添加好友", '<label for="find-user">WeLink 号码 / 昵称</label><input id="find-user" placeholder="输入 WeLink 号码或昵称" autocomplete="off"><div id="user-results" class="member-select"><p class="hint">输入至少两个字符，找到想联系的人。</p></div>');
    $("#find-user").oninput = (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value;
      searchTimer = setTimeout(async () => {
        try {
          const users = await api("/api/users?q=" + encodeURIComponent(q));
          const list = $("#user-results");
          if (!list) return;
          list.innerHTML = users.map((u) => '<div class="utility-row">'.concat(av(u), '<div class="body"><b>').concat(esc(u.name), "</b><p>").concat(esc(u.number || u.account), '</p></div><button class="secondary" data-request-user="').concat(u.id, '" data-name="').concat(esc(u.name), '">添加</button></div>')).join("") || '<div class="empty-list">未找到用户</div>';
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
    modal("创建群聊", '<label for="group-name">群名称</label><input id="group-name" maxlength="60" placeholder="给群聊起个名字"><label>选择好友</label><div class="member-select">'.concat(S.friends.map((u) => '<label class="check-row">'.concat(av(u)).concat(esc(u.name), '<input type="checkbox" value="').concat(u.id, '" name="group-member"></label>')).join("") || '<p class="hint">请先添加好友。</p>', "</div>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">创建群聊</button>');
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
    $("#main-content").innerHTML = '<header class="chat-head">'.concat(btn("back", "返回", "back", "").replace('class="icon-btn"', 'class="icon-btn mobile-back"'), '<h2>个人资料</h2></header><div class="contact-profile">').concat(av(u, "large", true), "<h2>").concat(esc(u.name), '</h2><span class="profile-line">WeLink 号：').concat(esc(u.number || u.account), '</span><p class="profile-bio">').concat(esc(u.bio || "这个人很酷，还没有写签名。"), '</p><button class="primary" data-start-chat="').concat(u.id, '">发消息</button></div>');
  }
  async function showRequests() {
    modal("好友通知", '<div class="inline-loading">正在读取…</div>', "", true);
    await refresh();
    $(".modal-body").innerHTML = S.requests.map((q) => '<div class="utility-row">'.concat(av(q), '<div class="body"><b>').concat(esc(q.name), "</b><p>").concat(q.sender === S.user.id ? "我：" : "").concat(esc(q.message), "</p><p>").concat(shortTime(q.created), "</p></div>").concat(q.status === "pending" && q.recipient === S.user.id ? '<div class="request-actions"><button class="secondary" data-resolve="'.concat(q.id, '" data-accept="false">拒绝</button><button class="primary" data-resolve="').concat(q.id, '" data-accept="true">同意</button></div>') : '<span class="muted">'.concat({ pending: "等待验证", accepted: "已添加", rejected: "已拒绝" }[q.status], "</span>"), "</div>")).join("") || '<div class="empty-list">暂无好友通知</div>';
  }
  async function chatDetail() {
    var _a;
    if (((_a = activeConversation()) == null ? void 0 : _a.kind) === "group") {
      await Groups.detail();
      return;
    }
    const c = await api("/api/conversations/".concat(S.active)), mine = c.owner === S.user.id, local = activeConversation();
    modal("聊天设置", '<div class="detail-members">'.concat(c.members.map((u) => '<div class="detail-member">'.concat(av(u), "<span>").concat(esc(u.name)).concat(u.id === c.owner && c.kind === "group" ? " · 群主" : "", "</span></div>")).join(""), "</div>").concat(c.kind === "group" ? '<label>群名称</label><input id="detail-name" value="'.concat(esc(c.name), '" maxlength="60" ').concat(mine ? "" : "disabled", '><label>群公告</label><textarea id="detail-notice" maxlength="2000" placeholder="暂无群公告" ').concat(mine ? "" : "disabled", ">").concat(esc(c.announcement), "</textarea>") : "", '<button class="chat-history-entry" data-action="search-history">查找聊天记录</button><label class="prefs-row">置顶聊天<input type="checkbox" id="detail-pin" ').concat(local.pinned ? "checked" : "", '></label><label class="prefs-row">消息免打扰<input type="checkbox" id="detail-mute" ').concat(local.muted ? "checked" : "", "></label>").concat(c.kind === "group" ? '<button class="secondary" data-action="invite-members">邀请好友</button>' : ""), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">保存</button>');
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
    n.innerHTML = '<section class="utility"><h2>文件管理器</h2><div id="file-list" class="inline-loading">正在读取…</div></section>';
    try {
      const files = await api("/api/files"), list = $("#file-list");
      if (!list) return;
      list.className = "";
      list.innerHTML = files.map((f) => '<div class="utility-row">'.concat(icon(f.mime.startsWith("image/") ? "image" : "file"), '<div class="body"><b>').concat(esc(f.name), "</b><p>").concat(bytes(f.size), " · ").concat(fullTime(f.created), "</p></div>").concat(btn("download", "下载", "download", 'data-download="'.concat(f.id, '" data-filename="').concat(esc(f.name), '"')), "</div>")).join("") || '<div class="empty-list">发送和接收的文件会保存在这里</div>';
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
  function profile() {
    modal("编辑资料", '<div style="text-align:center;margin:5px 0 25px">'.concat(av(S.user, "large"), '</div><label>昵称</label><input id="profile-name" value="').concat(esc(S.user.name), '" maxlength="32"><label>个性签名</label><input id="profile-bio" value="').concat(esc(S.user.bio), '" maxlength="150" placeholder="分享此刻的心情"><label>头像颜色</label><div class="color-list">').concat(["blue", "pink", "purple", "orange", "green", "cyan"].map((color) => '<button data-color="'.concat(color, '" class="').concat(color === S.user.avatar ? "selected" : "", '" aria-label="').concat(color, '">').concat(av(__spreadProps(__spreadValues({}, S.user), { avatar: color }), "small"), "</button>")).join(""), "</div>"), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">保存</button>');
    modalHandler = async () => {
      var _a;
      S.user = await api("/api/me", { method: "PATCH", body: { name: $("#profile-name").value, bio: $("#profile-bio").value, avatar: ((_a = $(".color-list .selected")) == null ? void 0 : _a.dataset.color) || "blue" } });
      closeModal();
      updateRail();
      if (S.tab === "profile") renderMyPage();
      toast("个人资料已更新");
    };
  }
  function renderMyPage() {
    $("#main-content").innerHTML = '<section class="utility"><div class="settings-body"><div class="contact-profile" style="padding:25px 0">'.concat(av(S.user, "large"), "<h2>").concat(esc(S.user.name), '</h2><span class="profile-line">WeLink 号：').concat(esc(S.user.number || S.user.account), '</span></div><button class="utility-row" style="width:100%" data-action="profile">').concat(icon("user"), '<div class="body" style="text-align:left">个人资料</div>').concat(icon("chevron"), '</button><button class="utility-row" style="width:100%" data-nav="files">').concat(icon("folder"), '<div class="body" style="text-align:left">我的文件</div>').concat(icon("chevron"), '</button><button class="utility-row" style="width:100%" data-nav="favorites">').concat(icon("star"), '<div class="body" style="text-align:left">我的收藏</div>').concat(icon("chevron"), "</button>").concat(S.config.platform === "android" ? '<button class="utility-row" style="width:100%" data-action="scan-qr"><div class="body" style="text-align:left">扫一扫 · 电脑登录</div></button>' : "", '<button class="utility-row" style="width:100%" data-action="settings">').concat(icon("settings"), '<div class="body" style="text-align:left">设置</div>').concat(icon("chevron"), "</button></div></section>");
  }
  function settings() {
    modal("设置", '<label class="prefs-row">深色外观<input type="checkbox" id="pref-dark" '.concat(document.body.classList.contains("dark") ? "checked" : "", '></label><label class="prefs-row">桌面消息通知<button class="secondary" data-action="notifications">开启通知</button></label><div class="prefs-row"><span>账号与安全</span><button class="secondary" data-action="security">管理</button></div><div class="prefs-row"><span>当前版本</span><span>0.1.0 预览版</span></div><div class="prefs-row"><span>服务器</span><span>').concat(esc(S.config.server || "本地"), '</span></div><p class="hint">聊天记录保存在服务器，登录同一账号即可同步。<br>远程协助每次都需要对方明确同意。</p><button class="secondary" data-action="connection">连接设置</button> <button class="secondary" data-action="licenses">开源许可</button>'), '<button class="secondary danger" data-action="logout">退出登录</button><button class="primary" data-action="modal-submit">完成</button>');
    modalHandler = async () => {
      document.body.classList.toggle("dark", $("#pref-dark").checked);
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
    contextMenu(x, y, (m.recalled ? "" : '<button data-action="quote" data-mid="'.concat(m.id, '">').concat(icon("reply"), '引用</button><button data-fw="single" data-mid="').concat(m.id, '">').concat(icon("send"), "转发</button>").concat(m.kind === "text" ? '<button data-action="copy-message" data-mid="'.concat(m.id, '">').concat(icon("copy"), "复制文字</button>") : "", '<button data-action="favorite" data-mid="').concat(m.id, '">').concat(icon("star"), "收藏</button>").concat(m.sender === S.user.id && Date.now() - m.created < 12e4 ? '<button data-action="recall" data-mid="'.concat(m.id, '">').concat(icon("history"), "撤回</button>") : "")) + '<button data-fw="select" data-mid="'.concat(m.id, '">').concat(icon("check"), '多选</button><button class="destructive" data-action="delete-message" data-mid="').concat(m.id, '">').concat(icon("trash"), "删除</button>"));
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
    d.innerHTML = [..."😀😃😄😁😆😅😂🙂😉😊🥰😍🤩😘😋😎🥳🤔🤗🤭🤫😴😪😮😯😳😱😢😭😤😡🤯🥺😇💙❤️💛💚💜✨🌟🎉🎈🎁🌷🌸🍀☀️🌈☕🍰🍉🍎🎵💡🔥👍👋👏🤝🙏💪👌✅"].map((v) => '<button data-emoji="'.concat(v, '">').concat(v, "</button>")).join("");
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
    queueRefresh();
  }
  function applyDeletion(message) {
    var _a;
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
      S.reply = null;
      renderShell();
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
    var _a;
    if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getDisplayMedia)) {
      toast("此设备请使用系统截图后发送图片");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 150));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      canvas.toBlob((b) => {
        if (b) upload(new File([b], "截图-" + Date.now() + ".png", { type: "image/png" }));
      }, "image/png");
    } catch (e) {
      if (e.name !== "NotAllowedError") toast("截图失败：" + e.message);
    } finally {
      stream == null ? void 0 : stream.getTracks().forEach((t) => t.stop());
    }
  }
  function renderRemoteHome() {
    $("#main-content").innerHTML = '<section class="utility"><h2>远程协助</h2><div class="settings-body"><div style="text-align:center;padding:28px 0;color:#80bced">'.concat(icon("monitor").replace("<svg", '<svg style="width:72px;height:72px;stroke-width:1"'), '</div><h3 style="text-align:center;font-weight:500;font-size:20px;margin-bottom:14px">屏幕另一边，也能帮到你</h3><p class="hint" style="text-align:center;color:#99a3b0;line-height:2;font-size:13px;margin-bottom:35px">在好友聊天中发起远程协助<br>共享屏幕，或邀请好友操作你的设备</p><div class="utility-row">').concat(icon("shield"), '<div class="body"><b>每次连接，都由你决定</b><p>对方同意后才开始，随时可以结束</p></div></div><div class="utility-row">').concat(icon("monitor"), '<div class="body"><b>Windows 与 Android 互联</b><p>复用 YuDesk 远控技术，支持加密传输</p></div></div><button class="primary" style="width:100%;margin-top:20px" data-nav="contacts">选择好友</button></div></section>');
  }
  function remoteChoices() {
    const c = activeConversation();
    if ((c == null ? void 0 : c.kind) !== "direct") {
      toast("请在好友单聊中使用远程协助");
      return;
    }
    modal("远程协助", '<button class="remote-choice" data-invite-remote="control" data-direction="request">'.concat(icon("monitor"), '<span><b>请求控制对方设备</b><p>对方同意后，帮助对方操作</p></span></button><button class="remote-choice" data-invite-remote="view" data-direction="request">').concat(icon("video"), '<span><b>请求观看对方屏幕</b><p>只看画面，不操作对方设备</p></span></button><button class="remote-choice" data-invite-remote="control" data-direction="share">').concat(icon("contacts"), '<span><b>邀请对方协助我</b><p>共享我的屏幕，允许对方操作</p></span></button><p class="hint">邀请在 60 秒后失效。安卓共享需要系统屏幕录制授权，触控需要无障碍权限。</p>'));
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
    modal("远程协助", '<div class="remote-invite">'.concat(av(((_a = activeConversation()) == null ? void 0 : _a.peer) || {}, "large"), "<h3>等待对方接受邀请…</h3><p>邀请将在 60 秒后自动失效<br>你可以随时取消</p></div>"), '<button class="secondary" data-action="stop-remote">取消邀请</button>');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(async () => {
      var _a2;
      if (((_a2 = S.remote) == null ? void 0 : _a2.id) === v.id && S.remote.state === "pending") {
        await stopRemote();
        toast("对方未响应，邀请已过期");
      }
    }, 6e4);
  }
  async function remoteEvent(v) {
    var _a;
    if (!S.user) return;
    if (v.state === "pending") {
      if (v.requester === S.user.id) return;
      S.remote = v;
      const from = S.friends.find((u) => u.id === v.requester) || { name: "好友" };
      modal("远程协助邀请", '<div class="remote-invite">'.concat(av(from, "large"), "<h3>").concat(esc(from.name), "</h3><p>").concat(v.host === S.user.id ? v.mode === "control" ? "请求观看并控制你的设备" : "请求观看你的屏幕" : "邀请你远程协助", "<br>同意后开始，随时可以结束</p></div>"), '<button class="secondary" data-action="reject-remote">拒绝</button><button class="primary" data-action="accept-remote">同意</button>');
      return;
    }
    ;
    if (((_a = S.remote) == null ? void 0 : _a.id) !== v.id) return;
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
    S.remoteTimer = setInterval(remoteTick, 120);
    await remoteTick();
  }
  var frameVersion = 0;
  var frameURL = "";
  var remoteTickBusy = false;
  var inputChain = Promise.resolve();
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
    node.innerHTML = '<header class="remote-toolbar">'.concat(icon("monitor"), '<b>远程协助</b><span id="remote-status" class="status">正在连接…</span><button class="secondary" data-action="remote-fullscreen">全屏</button><button class="primary" data-action="stop-remote">结束协助</button></header><div class="remote-canvas"><p id="remote-loading">正在等待对方画面…</p><img id="remote-image" tabindex="0" alt="远程设备屏幕"></div><div class="remote-touchbar"><button data-remote-key="Escape">返回</button><button data-remote-key="Home">主页</button><button data-action="remote-text">输入文字</button><button data-remote-key="Enter">回车</button></div>');
    document.body.append(node);
    const img = $("#remote-image");
    let held = false;
    const send = (events) => {
      inputChain = inputChain.then(() => action("/local/remote/input", { events })).catch((e) => toast(e.message));
    };
    const point = (e) => {
      const r = img.getBoundingClientRect();
      return { type: "move", x: Math.max(0, Math.round((e.clientX - r.left) * Number(img.dataset.width) / r.width)), y: Math.max(0, Math.round((e.clientY - r.top) * Number(img.dataset.height) / r.height)) };
    };
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
      if (((_a = S.remote) == null ? void 0 : _a.mode) !== "control" || Date.now() - moveAt < 35) return;
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
      action("/local/remote/release").catch(() => {
      });
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
    img.onblur = () => action("/local/remote/release").catch(() => {
    });
  }
  async function stopRemote(notify = true) {
    var _a;
    const v = S.remote;
    S.remote = null;
    S.remoteLocal = null;
    clearInterval(S.remoteTimer);
    clearTimeout(toastTimer);
    S.remoteTimer = null;
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
    var _a, _b, _c, _d;
    const b = e.target.closest("button,a,[data-preview-image]");
    if (!e.target.closest(".context-menu")) (_a = $(".context-menu")) == null ? void 0 : _a.remove();
    if (!b) return;
    try {
      if (b.dataset.nav) {
        S.tab = b.dataset.nav;
        S.search = "";
        S.profile = null;
        renderShell();
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
        S.profile = S.friends.find((u) => u.id === b.dataset.profile);
        renderMain();
        $(".shell").classList.add("in-chat");
        return;
      }
      if (b.dataset.startChat) {
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
      (_b = $(".context-menu")) == null ? void 0 : _b.remove();
      switch (a) {
        case "register":
          renderAuth(true);
          break;
        case "login":
          renderAuth(false);
          break;
        case "close-modal":
          closeModal();
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
          S.active = null;
          S.profile = null;
          renderShell();
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
          contextMenu(r.left - 120, r.bottom + 5, '<button data-action="add-friend">'.concat(icon("contacts"), '添加好友</button><button data-group="search">').concat(icon("search"), '查找群聊</button><button data-action="create-group">').concat(icon("chat"), "创建群聊</button>").concat(S.config.platform === "android" ? '<button data-action="scan-qr">扫一扫</button>' : ""));
          break;
        }
        case "more-menu": {
          const r = b.getBoundingClientRect();
          contextMenu(r.left + 40, r.top - 80, '<button data-action="settings">'.concat(icon("settings"), '设置</button><button data-action="logout">').concat(icon("logout"), "退出登录</button>"));
          break;
        }
        case "emoji":
          emojis();
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
          renderReply();
          (_c = $("#composer")) == null ? void 0 : _c.focus();
          break;
        case "cancel-reply":
          S.reply = null;
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
          await copyMessage(((_d = S.messages.find((m) => m.id === b.dataset.mid)) == null ? void 0 : _d.text) || "");
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
            toast("已到最新消息");
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
          const older = await api("/api/conversations/".concat(S.active, "/messages?before=").concat(S.messages[0].seq));
          if (!older.length) {
            b.remove();
            toast("已经是最早的消息");
            break;
          }
          const area = $("#messages"), h = area.scrollHeight;
          S.messages = [...older, ...S.messages];
          renderMessages(true);
          area.scrollTop = area.scrollHeight - h;
          break;
        }
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
          if (!document.fullscreenElement) await $(".remote-screen").requestFullscreen();
          else await document.exitFullscreen();
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
    if (e.target.classList.contains("modal-backdrop") && !S.remote) closeModal();
  });
  document.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("[data-message]");
    if (el) {
      e.preventDefault();
      const m = S.messages.find((x) => x.id === el.dataset.message);
      if (m) messageMenu(m, e.clientX, e.clientY);
    }
  });
  var touchTimer;
  var suppressMessageClickUntil = 0;
  document.addEventListener("click", (e) => {
    if (Date.now() < suppressMessageClickUntil && e.target.closest("[data-message]")) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("touchstart", (e) => {
    const el = e.target.closest("[data-message]");
    if (el) {
      const p = e.touches[0];
      touchTimer = setTimeout(() => {
        const m = S.messages.find((x) => x.id === el.dataset.message);
        if (m) {
          suppressMessageClickUntil = Date.now() + 1e3;
          messageMenu(m, p.clientX, p.clientY);
        }
      }, 550);
    }
  }, { passive: true });
  for (const ev of ["touchend", "touchmove", "touchcancel"]) document.addEventListener(ev, () => clearTimeout(touchTimer), { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = "WeLink";
      if (S.active && S.user) markRead().catch(() => {
      });
    } else action("/local/remote/release").catch(() => {
    });
  });
  document.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && window.welinkDrag && !e.target.closest("button,input,textarea,a") && (e.target.closest(".chat-head") || e.clientY < 28)) window.welinkDrag();
  });
  document.addEventListener("keydown", (e) => {
    var _a;
    if (e.key === "Escape") {
      if ($(".context-menu")) $(".context-menu").remove();
      else if (!S.remote) closeModal();
      (_a = $(".popup")) == null ? void 0 : _a.remove();
    }
  });
  if (localStorage.getItem("welink_dark") === "true") document.body.classList.add("dark");
  var Media = createMedia({ S, api, action, modal, closeModal, toast, esc, icon, fileURL, randomID, renderMessages, queueRefresh, upload });
  var Groups = createGroups({ S, api, action, modal, closeModal, toast, esc, icon, av, refresh, selectConversation, renderMain, copy: copyMessage, stopMedia: () => Media.reset() });
  var Forwarding = createForwarding({ S, api, action, modal, closeModal, toast, esc, icon, av, preview, fullTime, bytes, fileURL, randomID, renderMessages, queueRefresh, mediaBubble: Media.bubble });
  var History = createHistory({ S, api, modal, toast, esc, preview, fullTime, jump: jumpMessage });
  var Meetings = createMeetings({ api, action, S, modal, toast, esc, icon });
  var Security = createSecurity({ api, action, S, modal, toast, esc, icon, logout });
  var QR = createQRLogin({ action, S, modal, toast, esc, enter, renderAuth, windows, logo, icon });
  (async () => {
    try {
      S.config = await api("/local/config");
      if (S.token) {
        try {
          S.user = await api("/api/me");
          await enter();
        } catch (e) {
          S.token = "";
          localStorage.removeItem("welink_token");
          renderAuth();
        }
      } else renderAuth();
    } catch (e) {
      renderAuth();
      $("#auth-error").textContent = "连接服务失败：" + e.message;
    }
  })();
})();
