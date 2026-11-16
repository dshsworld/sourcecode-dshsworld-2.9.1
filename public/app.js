"use strict";

(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const floorRank = (floor) => {
    const text = String(floor).toUpperCase();
    if (text === "ELV") return 999;
    const basement = text.match(/^B(\d+)/);
    if (basement) return -Number(basement[1]);
    const above = text.match(/^(\d+(?:\.\d+)?)/);
    return above ? Number(above[1]) : 500;
  };
  const normalizeYaw = (yaw) => ((Number(yaw) + 180) % 360 + 360) % 360 - 180;

  const state = {
    tour: { scenes: [], links: [] },
    scenes: new Map(),
    currentSceneId: null,
    csrf: null,
    admin: false,
    markingLocations: false,
    navigating: false,
  };

  const elements = {
    canvas: $("#pano-canvas"),
    hotspots: $("#hotspot-layer"),
    cursorArrow: $("#cursor-arrow"),
    loading: $("#loading"),
    welcome: $("#welcome"),
    elevatorPanel: $("#elevator-panel"),
    elevatorButtons: $("#elevator-buttons"),
    elevatorDisplayFloor: $("#elevator-display-floor"),
    adminButton: $("#admin-button"),
    adminDock: $("#admin-dock"),
    crosshair: $("#aim-crosshair"),
    aimReadout: $("#aim-readout"),
    graphStage: $("#node-graph-stage"),
    graphCanvas: $("#node-graph-canvas"),
    toastRegion: $("#toast-region"),
  };


  let viewer;
  try {
    viewer = new window.PanoramaViewer(elements.canvas, elements.hotspots);
  } catch (error) {
    elements.loading.innerHTML = `<p>${error.message}</p>`;
    return;
  }

  const backgroundMusic = (() => {
    const audio = $("#background-music");
    const button = $("#music-toggle");
    audio.loop = true;
    audio.volume = 0.16;
    const syncButton = () => {
      const playing = !audio.paused && !audio.ended;
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "배경음악 끄기" : "배경음악 켜기");
      button.title = playing ? "배경음악 끄기" : "배경음악 켜기";
    };
    const start = () => {
      audio.play().then(syncButton).catch(syncButton);
    };
    const toggle = () => {
      if (audio.paused) start();
      else audio.pause();
      syncButton();
    };
    audio.addEventListener("play", syncButton);
    audio.addEventListener("pause", syncButton);
    button.addEventListener("click", toggle);
    return { start, toggle };
  })();

  async function api(url, options = {}) {
    const config = { credentials: "same-origin", ...options, headers: { ...(options.headers || {}) } };
    if (state.csrf && config.method && config.method !== "GET") config.headers["X-CSRF-Token"] = state.csrf;
    if (config.body && !(config.body instanceof FormData) && typeof config.body !== "string") {
      config.headers["Content-Type"] = "application/json";
      config.body = JSON.stringify(config.body);
    }
    const response = await fetch(url, config);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || (response.status === 413 ? '업로드 용량 제한을 초과했습니다. 사진 용량을 줄여 다시 시도해 주세요.' : response.status === 401 ? '로그인이 만료되었습니다. ADMIN에서 다시 로그인해 주세요.' : `요청 실패 (${response.status})`));
    return payload;
  }

  function toast(message, tone = "default") {
    const item = document.createElement("div");
    item.className = `toast toast-${tone}`;
    item.textContent = message;
    elements.toastRegion.append(item);
    requestAnimationFrame(() => item.classList.add("is-visible"));
    setTimeout(() => {
      item.classList.remove("is-visible");
      setTimeout(() => item.remove(), 250);
    }, 3200);
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }

  function imageFor(scene) {
    return scene.image4k || scene.image8k;
  }

  let placingArrow = false;
  let arrowPreview = null;
  let touchSelectedSceneId = null;
  function hideCursorArrow() {
    elements.cursorArrow.hidden = true;
    elements.cursorArrow.classList.remove("is-touch");
    touchSelectedSceneId = null;
  }
  function showCursorArrow(link, point, touch = false) {
    elements.cursorArrow.hidden = false;
    elements.cursorArrow.classList.toggle("is-touch", touch);
    elements.cursorArrow.style.left = `${point.x}px`;
    elements.cursorArrow.style.top = `${point.y}px`;
    elements.cursorArrow.title = link.label || "다음 위치로 이동";
  }
  function cancelArrowPlacement() {
    placingArrow = false;
    arrowPreview = null;
    $("#arrow-placement").hidden = true;
    document.body.classList.remove("placing-arrow");
    setViewerLinks();
  }

  const arrowEditor = new window.ArrowPositionEditor({
    canEdit: () => state.admin && !state.navigating,
    getLinks: (id) => arrowLinks(id),
    savePosition: async (id, point) => {
      const saved = await api(`/api/admin/links/${id}`, { method: "PATCH", body: point });
      const link = state.tour.links.find(link => link.id === id);
      if (link) Object.assign(link, { yaw: saved.yaw, pitch: saved.pitch, positioned: saved.positioned });
      // No panorama reload: keep the exact view and all other link records.
    },
    onChange: renderArrowEditor,
  });

  function renderArrowEditor() {
    const active = arrowEditor.active;
    $("#arrow-editor").hidden = !active;
    document.body.classList.toggle("editing-arrows", active);
    document.body.classList.toggle("arrow-targeting", active && arrowEditor.phase !== "select");
    hideCursorArrow();
    if (active) {
      const select = $("#arrow-edit-target");
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "옮길 화살표 선택";
      select.append(placeholder);
      for (const link of arrowLinks(arrowEditor.sourceId)) {
        const target = state.scenes.get(link.toScene);
        const option = document.createElement("option");
        option.value = String(link.id);
        option.textContent = `${arrowNodeLabel(target)}${link.positioned === 0 ? " · 위치 미지정" : ""}`;
        select.append(option);
      }
      select.value = arrowEditor.selected ? String(arrowEditor.selected.id) : "";
      select.disabled = arrowEditor.saving;
      $("#arrow-edit-status").textContent = arrowEditor.message;
      $("#arrow-edit-clear").disabled = arrowEditor.saving || !arrowEditor.selected;
      $("#arrow-edit-done").disabled = arrowEditor.saving;
      $("#arrow-editor").setAttribute("aria-busy", String(arrowEditor.saving));
    }
    setViewerLinks();
  }

  function openArrowEditor(linkId = null) {
    if (!state.admin || state.navigating || arrowEditor.saving) return;
    if (!arrowLinks().length) { toast("이 위치에 연결된 이동 화살표가 없습니다."); return; }
    cancelArrowPlacement();
    closeDialog("links-dialog");
    arrowEditor.open(state.currentSceneId);
    if (linkId != null) selectArrowForEditing(linkId, true);
    $("#pano-canvas").focus({ preventScroll: true });
  }

  function selectArrowForEditing(id, focus = false) {
    if (!arrowEditor.select(id || null)) return;
    const selected = arrowEditor.selected;
    if (focus && selected && selected.positioned !== 0) {
      const point = viewer.imageToWorldAngles(selected);
      viewer.setView(point.yaw, point.pitch, viewer.getView().hfov);
    }
  }

  $("#arrow-edit-target").addEventListener("change", event => selectArrowForEditing(event.target.value, true));
  $("#arrow-edit-clear").addEventListener("click", () => arrowEditor.select(null));
  $("#arrow-edit-done").addEventListener("click", () => {
    if (arrowEditor.close()) $("#arrow-edit-button").focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && arrowEditor.active && arrowEditor.close()) event.preventDefault();
  });

  const annotationDrafts=new Map();
  let annotationEditing=false;
  let annotationHidden=false;
  let annotationSaving=false;
  try { annotationHidden=localStorage.getItem("dshs-hide-annotation")==="1"; } catch {}
  function renderAnnotation() {
    const scene=state.scenes.get(state.currentSceneId);
    const body=$("#annotation-body"), toggle=$("#annotation-toggle");
    body.hidden=annotationHidden;
    toggle.textContent=annotationHidden?"주석 보이기":"주석 숨기기";
    toggle.setAttribute("aria-expanded",String(!annotationHidden));
    $("#annotation-location").textContent=scene?sceneLabel(scene):"";
    $("#annotation-text").textContent=scene?.annotation||"아직 등록된 주석이 없습니다.";
    $("#annotation-text").hidden=annotationEditing;
    $("#annotation-edit").hidden=!state.admin||annotationEditing;
    $("#annotation-form").hidden=!state.admin||!annotationEditing;
    $("#annotation-input").value=scene?(annotationDrafts.get(scene.id)??scene.annotation??""):"";
    $("#annotation-status").textContent="";
  }
  $("#annotation-toggle").addEventListener("click",()=>{
    annotationHidden=!annotationHidden;
    try{localStorage.setItem("dshs-hide-annotation",annotationHidden?"1":"0");}catch{}
    renderAnnotation();
  });
  $("#annotation-edit").addEventListener("click",()=>{annotationEditing=true;renderAnnotation();$("#annotation-input").focus();});
  $("#annotation-input").addEventListener("input",()=>{
    if(state.currentSceneId)annotationDrafts.set(state.currentSceneId,$("#annotation-input").value);
  });
  $("#annotation-cancel").addEventListener("click",()=>{
    annotationDrafts.delete(state.currentSceneId);annotationEditing=false;renderAnnotation();
  });
  $("#annotation-form").addEventListener("submit",async(event)=>{
    event.preventDefault();if(annotationSaving||!state.admin)return;
    const id=state.currentSceneId,text=$("#annotation-input").value;
    const button=event.currentTarget.querySelector('[type="submit"]');
    annotationSaving=true;button.disabled=true;
    try {
      const result=await api(`/api/admin/scenes/${encodeURIComponent(id)}/annotation`,{method:"PUT",body:{text}});
      const scene=state.scenes.get(id);if(scene)scene.annotation=result.text;
      if(annotationDrafts.get(id)===text)annotationDrafts.delete(id);
      if(state.currentSceneId===id){annotationEditing=false;renderAnnotation();$("#annotation-status").textContent="저장했습니다.";}
    } catch(error){if(state.currentSceneId===id)$("#annotation-status").textContent=error.message;else toast(error.message,"error");}
    finally{annotationSaving=false;button.disabled=false;}
  });

  async function loadTour() {
    const revision=graphLocationRevision;
    const tour=await api("/api/tour");
    // An earlier tour response must not undo a confirmation saved while it
    // was in flight. Later refreshes still receive other creators' changes.
    for(const scene of tour.scenes) {
      const edit=graphLocationChanges.get(scene.id);
      if(edit&&edit.revision>revision)scene.locationConfirmed=edit.confirmed?1:0;
    }
    state.tour = tour;
    state.scenes = new Map(state.tour.scenes.map((scene) => [scene.id, scene]));
    if ($("#node-graph-dialog").open) renderNodeGraph();
  }

  let elevatorArrival=null;
  let elevatorBusy=false;
  function renderElevatorPanel(scene) {
    const cab=scene.nodeType==="elevator-cab", landing=scene.nodeType==="elevator-landing";
    elements.elevatorPanel.hidden=!(cab||landing);
    elements.elevatorButtons.replaceChildren();
    if(!cab&&!landing)return;
    elements.elevatorDisplayFloor.textContent=cab?(elevatorArrival?.floor||"—"):scene.floor;
    $("#elevator-status").textContent=cab?"도착할 층을 선택하세요":"엘리베이터";
    $("#elevator-exit").hidden=!cab;
    $("#elevator-exit").disabled=!elevatorArrival;
    if(landing){
      const service=currentLinks().find(l=>state.scenes.get(l.toScene)?.nodeType==="elevator-cab");
      if(service){
        const button=document.createElement("button");button.type="button";button.className="elevator-enter";button.textContent="들어가기";
        button.addEventListener("click",()=>navigate(service.toScene));elements.elevatorButtons.append(button);
      }
      return;
    }
    const serviceIds=new Set(currentLinks().filter(l=>l.kind==="elevator").map(l=>l.toScene));
    const landings=state.tour.scenes.filter(s=>s.nodeType==="elevator-landing" && s.building===scene.building && s.elevatorGroup===scene.elevatorGroup && serviceIds.has(s.id)).sort((a,b)=>floorRank(b.floor)-floorRank(a.floor));
    for(const destination of landings){
      const button=document.createElement("button");button.type="button";button.textContent=destination.floor;button.disabled=elevatorBusy;
      button.addEventListener("click",async()=>{
        if(elevatorBusy)return;
        elevatorBusy=true;$("#elevator-exit").disabled=true;
        [...elements.elevatorButtons.children].forEach(b=>b.disabled=true);
        $("#elevator-status").textContent=destination.floor+" 이동 중…";
        await new Promise(resolve=>setTimeout(resolve,650));
        if(state.currentSceneId!==scene.id){elevatorBusy=false;return;}
        elevatorArrival=destination;elevatorBusy=false;
        renderElevatorPanel(scene);$("#elevator-status").textContent=destination.floor+" 도착";
      });
      elements.elevatorButtons.append(button);
    }
  }
  $("#elevator-exit").addEventListener("click",()=>{
    if(elevatorArrival&&!elevatorBusy)navigate(elevatorArrival.id);
  });

  function currentLinks() {
    return state.tour.links.filter((link) => link.fromScene === state.currentSceneId && state.scenes.has(link.toScene));
  }

  function arrowLinks(id = state.currentSceneId) {
    const scene = state.scenes.get(id);
    return state.tour.links.filter(link => link.fromScene === id && state.scenes.has(link.toScene)
      && !(link.kind === "elevator" && (scene?.nodeType === "elevator-cab" || scene?.nodeType === "elevator-landing")));
  }

  function setViewerLinks() {
    const selectedId = arrowEditor.selected?.id;
    const hotspots = arrowLinks().filter(link => link.positioned !== 0 || (link.id === selectedId && arrowEditor.preview)).map(link => {
      const selected = link.id === selectedId;
      const target = state.scenes.get(link.toScene);
      return {
        ...link,
        ...viewer.imageToWorldAngles(selected && arrowEditor.preview ? arrowEditor.preview : link),
        pinned: link.positioned === 2 || arrowEditor.active || Boolean(viewer.imageOrientation?.yaw || viewer.imageOrientation?.pitch),
        selected,
        displayLabel: arrowEditor.active ? arrowNodeLabel(target) : "",
        label: arrowEditor.active ? `${arrowNodeLabel(target)} 방향 화살표 선택` : link.label,
        onClick: () => arrowEditor.active ? selectArrowForEditing(link.id) : navigate(link.toScene),
      };
    });
    if (arrowPreview) hotspots.push({ ...viewer.imageToWorldAngles(arrowPreview), pinned: true, kind: "preview", label: "새 화살표 위치" });
    viewer.setHotspots(hotspots);
  }

  async function navigate(id, { replaceHash = true } = {}) {
    const scene = state.scenes.get(id);
    if (!scene || state.navigating) return;
    if (arrowEditor.active && !arrowEditor.close()) { toast("화살표 위치를 저장 중입니다. 잠시만 기다려 주세요."); return; }
    hideCursorArrow();
    if (placingArrow) cancelArrowPlacement();
    state.navigating = true;
    elements.loading.hidden = false;
    elements.loading.classList.remove("is-hidden");
    try {
      const fromId = state.currentSceneId;
      const returnLink = state.tour.links.find((link) => link.fromScene === id && link.toScene === fromId && link.positioned !== 0);
      const view = window.PanoramaViewer.arrivalView(scene, returnLink);
      await viewer.load(imageFor(scene), view, scene.thumb);
      viewer.setImageOrientation(scene.imageYaw || 0, scene.imagePitch || 0);
      const previous=state.scenes.get(state.currentSceneId);
      if(scene.nodeType==="elevator-cab" && previous?.building===scene.building){
        elevatorArrival=previous.nodeType==="elevator-landing"?previous:state.tour.scenes.find(s=>s.nodeType==="elevator-landing" && s.building===scene.building && s.floor===previous.floor) || null;
      }
      if(scene.nodeType!=="elevator-cab")elevatorBusy=false;
      state.currentSceneId = scene.id;
      annotationEditing=state.admin && annotationDrafts.has(scene.id);
      renderAnnotation();
      renderElevatorPanel(scene);
      setViewerLinks();
      const nextImages = currentLinks().map((link) => state.scenes.get(link.toScene)).filter(Boolean)
        .map(imageFor).filter(Boolean).filter((url) => url !== imageFor(scene)).slice(0, 2);
      const prefetch = () => nextImages.forEach((url) => viewer.preload(url).catch(() => {}));
      if (window.requestIdleCallback) window.requestIdleCallback(prefetch, { timeout: 1000 });
      else setTimeout(prefetch, 100);
      if (replaceHash) history.replaceState(null, "", `#scene=${encodeURIComponent(scene.id)}`);
      updateAdminReadout();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      state.navigating = false;
      elements.loading.classList.add("is-hidden");
      setTimeout(() => { elements.loading.hidden = true; }, 300);
    }
  }

  function setAdminMode(active, csrf = null) {
    state.admin = active;
    state.csrf = csrf;
    if (!active) state.markingLocations = false;
    syncGraphMarkMode();
    elements.adminDock.hidden = !active;
    elements.crosshair.hidden = !active;
    elements.adminButton.classList.toggle("is-active", active);
    elements.adminButton.textContent = active ? "EDITING" : "ADMIN";
    document.body.classList.toggle("admin-mode", active);
    annotationEditing=false;
    renderAnnotation();
    if (!active) {
      arrowEditor.close(true);
      cancelArrowPlacement();
      closeDialog("node-graph-dialog");
    }
    updateAdminReadout();
  }

  function updateAdminReadout() {
    if (!state.admin) return;
    const view = viewer.getView();
    elements.aimReadout.textContent = `YAW ${view.yaw.toFixed(1)}° · PITCH ${view.pitch.toFixed(1)}°`;
  }

  async function refreshAfterEdit(preferredId = state.currentSceneId) {
    await loadTour();
    const target = state.scenes.has(preferredId) ? preferredId : state.tour.scenes.find((scene) => scene.isStart)?.id || state.tour.scenes[0]?.id;
    if (target) await navigate(target);
  }

  function nextNodeId() {
    const used = new Set(state.tour.scenes.map((scene) => scene.id));
    for (let number = 1; number <= 9999; number += 1) {
      const id = `N${String(number).padStart(3, "0")}`;
      if (!used.has(id)) return id;
    }
    return `N${Date.now()}`;
  }

  function sceneLabel(scene) {
    return `${scene.building || "본관"} · ${scene.floor} · ${scene.title} (${scene.id})`;
  }

  function arrowNodeLabel(scene) {
    const id = String(scene.id).split("-").pop();
    const number = /^\d+$/.test(id) ? `${Number(id)}번` : id;
    const floor = scene.floor === "OUT" ? "" : scene.floor === "ELV" ? "엘리베이터" : String(scene.floor).replace(/^B(\d+)F$/i,"지하 $1층").replace(/^(\d+(?:\.\d+)?)F$/i,"$1층");
    return [scene.building || "본관",floor,scene.floor === "ELV" ? "" : number].filter(Boolean).join(" ");
  }

  function openUpload() {
    const form = $("#upload-form");
    form.reset();
    $("#insp-hint").hidden = true;
    $("#upload-status").textContent = '';
    $("#upload-progress").hidden = true;
    const current=state.scenes.get(state.currentSceneId);
    form.elements.id.value=current?.id||nextNodeId();
    form.elements.replace.value=current?"true":"false";
    form.elements.title.value=current?.title||"";
    form.elements.floor.value=current?.floor||"1F";
    form.elements.building.value=current?.building||"본관";
    form.elements.nodeType.value=current?.nodeType||"hall";
    $("#upload-new-node").hidden=false;
    form.elements.initialYaw.value = "90";
    form.elements.initialPitch.value = "0";
    openDialog("upload-dialog");
    const selectedId = form.elements.id.value;
    api(`/api/admin/scenes/${encodeURIComponent(selectedId)}/source`).then(result => {
      if (form.elements.id.value === selectedId && result.pending) $("#upload-status").textContent = `이전에 저장된 ${result.filename} 대신 원본 INSP를 다시 선택하면 자동 변환됩니다.`;
    }).catch(() => {});
  }

  function openConnect() {
    if (arrowEditor.active && !arrowEditor.close()) return;
    cancelArrowPlacement();
    const form = $("#connect-form");
    form.reset();
    delete form.dataset.linkId;
    form.elements.toScene.disabled=false;
    form.elements.reverse.disabled=false;
    $("#connect-from").value = state.currentSceneId;
    $("#connect-from-label").value = sceneLabel(state.scenes.get(state.currentSceneId));
    const target = $("#connect-target");
    target.replaceChildren();
    state.tour.scenes.filter((scene) => scene.id !== state.currentSceneId).forEach((scene) => {
      const option = document.createElement("option");
      option.value = scene.id;
      option.textContent = sceneLabel(scene);
      target.append(option);
    });
    const view = viewer.getView();
    $("#connect-yaw").value = view.yaw.toFixed(1);
    $("#connect-pitch").value = view.pitch.toFixed(1);
    $("#connect-save").disabled = true;
    form.elements.label.value=state.scenes.get(target.value)?.title||"이동";
    openDialog("connect-dialog");
  }

  function openEdit() {
    const scene = state.scenes.get(state.currentSceneId);
    if (!scene) return;
    $("#edit-id").value = scene.id;
    $("#edit-title").value = scene.title;
    $("#edit-floor").value = scene.floor;
    $("#edit-building").value = scene.building;
    $("#edit-node-type").value = scene.nodeType;
    $("#use-current-view").checked = false;
    $("#edit-image-yaw").value = String(scene.imageYaw || 0);
    $("#edit-image-pitch").value = String(scene.imagePitch || 0);
    openDialog("edit-dialog");
  }

  function openLinkManager() {
    const list = $("#link-manager-list");
    list.replaceChildren();
    const links = currentLinks();
    if (!links.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "이 노드에서 출발하는 연결이 없습니다.";
      list.append(empty);
    }
    for (const link of links) {
      const row = document.createElement("div");
      row.className = "link-manager-row";
      const target = state.scenes.get(link.toScene);
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = target ? arrowNodeLabel(target) : link.toScene;
      const meta = document.createElement("small");
      meta.textContent = link.positioned === 0 ? "화살표 위치 지정 필요" : `${link.yaw.toFixed(1)}°`;
      copy.append(title, meta);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "danger-button small-button";
      button.textContent = "삭제";
      button.addEventListener("click", async () => {
        if (!confirm(`‘${link.label}’ 연결을 삭제할까요?`)) return;
        try {
          await api(`/api/admin/links/${link.id}`, { method: "DELETE" });
          await refreshAfterEdit();
          closeDialog("links-dialog");
          toast("연결을 삭제했습니다.");
        } catch (error) { toast(error.message, "error"); }
      });
      const edit=document.createElement("button");edit.type="button";edit.className="secondary-button small-button";edit.textContent=link.positioned===0?"위치 지정":"위치 수정";
      edit.addEventListener("click",()=>{
        openArrowEditor(link.id);
      });
      row.append(copy, edit, button);
      list.append(row);
    }
    openDialog("links-dialog");
  }

  function renderNodeGraph() {
    syncGraphMarkMode();
    const canvas=elements.graphCanvas;
    const building=$("#graph-building").value || "본관";
    canvas.classList.toggle("gungri-plan",building==="궁리관");
    canvas.classList.toggle("geogyeong-plan",building==="거경관");
    canvas.classList.toggle("outdoor-plan",building==="야외");
    const all=state.tour.scenes.filter(s=>s.building===building);
    canvas.replaceChildren();
    if (!all.length) {
      const empty=document.createElement("p"); empty.className="graph-empty"; empty.textContent=building+" · 준비 중"; canvas.append(empty);
      canvas.style.width="100%"; canvas.style.height="100%"; return;
    }
    const positions=new Map();
    const outdoor=building==="야외";
    const floors=[...new Set(all.map(s=>s.floor))].sort((a,b)=>floorRank(b)-floorRank(a));
    const width=outdoor?930:1080, laneHeight=245, height=outdoor?1450:floors.length*laneHeight+30;
    canvas.style.width=width+"px"; canvas.style.height=height+"px";
    if(outdoor){
      const title=document.createElement("strong");title.className="campus-map-title";title.textContent="야외 · 캠퍼스 전체";canvas.append(title);
      const zones=[
        ["본관동",75,72,285,610,"main"],["운동장",405,235,465,475,"field"],
        ["궁리관",75,725,425,305,"gungri"],["야외 코트",505,710,285,315,"court"],
        ["거경관",82,1040,250,275,"geogyeong"],["정문",365,1235,305,170,"gate"],
      ];
      for(const [label,left,top,w,h,kind] of zones){
        const zone=document.createElement("div");zone.className=`campus-zone campus-zone-${kind}`;zone.textContent=label;
        Object.assign(zone.style,{left:left+"px",top:top+"px",width:w+"px",height:h+"px"});canvas.append(zone);
      }
      all.forEach((s,j)=>positions.set(s.id,{x:s.mapX==null?90+(j%8)*95:70+s.mapX,y:s.mapY==null?80+Math.floor(j/8)*70:58+s.mapY}));
    }
    const ns="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(ns,"svg");
    svg.classList.add("node-graph-lines"); svg.setAttribute("width",width); svg.setAttribute("height",height); canvas.append(svg);
    if(!outdoor){
      floors.forEach((floor,i)=>{
        const lane=document.createElement("div"); lane.className="plan-lane"; lane.style.top=(i*laneHeight)+"px"; lane.style.height=laneHeight+"px";
        const heading=document.createElement("strong"); heading.textContent=building+" · "+(floor==="ELV"?"엘리베이터 내부":floor.includes(".5")?`${Math.floor(parseFloat(floor))}–${Math.floor(parseFloat(floor))+1}층 중간층`:floor); lane.append(heading); canvas.append(lane);
        all.filter(s=>s.floor===floor).forEach((s,j)=>{
          positions.set(s.id,{x:s.mapX==null?180+(j%8)*105:140+(s.mapX-275)*1.15,y:i*laneHeight+48+(s.mapY==null?Math.floor(j/8)*65:s.mapY*.85)});
        });
      });
    }
    // Boundary destinations live in a separate labelled rail: a diagonal
    // across the floor plan looks like unrelated indoor nodes are joined.
    const boundary = state.tour.links.filter(l => positions.has(l.fromScene) && state.scenes.get(l.toScene)?.building !== building && state.scenes.has(l.toScene));
    boundary.sort((a,b) => positions.get(a.fromScene).y - positions.get(b.fromScene).y);
    if (boundary.length) {
      canvas.style.width = (width + 268) + "px";
      const rail=document.createElement("aside"); rail.className="boundary-rail"; rail.style.left=(width + 5)+"px";
      const title=document.createElement("strong");title.textContent="다른 건물 연결";rail.append(title);
      for(const link of boundary){
        const source=state.scenes.get(link.fromScene),target=state.scenes.get(link.toScene);
        const row=document.createElement("button");row.type="button";
        row.textContent=`${source.building} ${source.floor} ${source.id.split('-').pop()} → ${target.building} ${target.floor} ${target.id.split('-').pop()}`;
        row.title=sceneLabel(source)+" → "+sceneLabel(target);
        row.dataset.sceneId=target.id;
        updateGraphMarkVisual(row,target);
        row.addEventListener("click",()=>void handleGraphNodeClick(target.id));
        rail.append(row);
      }
      canvas.append(rail);
    }
    const seen=new Set();
    for(const l of state.tour.links){
      const a=positions.get(l.fromScene),b=positions.get(l.toScene);
      if(!a||!b) continue;
      const key=[l.fromScene,l.toScene].sort().join("|"); if(seen.has(key))continue; seen.add(key);
      const line=document.createElementNS(ns,"line");
      line.setAttribute("x1",a.x);line.setAttribute("y1",a.y);line.setAttribute("x2",b.x);line.setAttribute("y2",b.y);
      line.classList.add("graph-edge");
      if(l.kind==="elevator")line.classList.add("is-elevator");
      if(l.kind==="walk-green")line.classList.add("is-secondary-path");
      if(l.fromScene===state.currentSceneId||l.toScene===state.currentSceneId)line.classList.add("is-current");
      const title=document.createElementNS(ns,"title");title.textContent=sceneLabel(state.scenes.get(l.fromScene))+" → "+sceneLabel(state.scenes.get(l.toScene));line.append(title);svg.append(line);
    }
    for(const s of all){
      const p=positions.get(s.id);const button=document.createElement("button");
      button.type="button";button.className="plan-node type-"+s.nodeType;button.style.left=p.x+"px";button.style.top=p.y+"px";
      if(s.id===state.currentSceneId)button.classList.add("is-current");
      button.textContent=s.id==="M-ELV"?"E":s.id.split("-").pop();
      button.dataset.sceneId=s.id;
      updateGraphMarkVisual(button,s);
      button.addEventListener("click",()=>void handleGraphNodeClick(s.id));
      canvas.append(button);
    }

  }

  const graphMarkPending = new Set();
  const graphLocationChanges = new Map();
  let graphLocationRevision = 0;

  function updateGraphMarkVisual(button,scene) {
    const confirmed=Boolean(scene.locationConfirmed),marking=state.admin&&state.markingLocations;
    button.classList.toggle("is-location-confirmed",confirmed);
    button.disabled=graphMarkPending.has(scene.id);
    button.setAttribute("aria-busy",String(button.disabled));
    if(marking)button.setAttribute("aria-pressed",String(confirmed));
    else button.removeAttribute("aria-pressed");
    const name=arrowNodeLabel(scene)+(confirmed?" · 위치 확인됨":"");
    const action=marking?(confirmed?"확인 표시 해제":"위치 확인 표시"):"보기";
    button.title=name+" · "+action;
    button.setAttribute("aria-label",name+" · "+action);
  }

  function syncGraphMarkMode() {
    const marking=Boolean(state.admin&&state.markingLocations),button=$("#graph-mark-mode");
    button.hidden=!state.admin;
    button.textContent=marking?"표시 모드 끄기":"위치 확인 표시";
    button.setAttribute("aria-pressed",String(marking));
    button.classList.toggle("is-active",marking);
    $("#graph-description").textContent=marking?"노드를 클릭하면 확인 표시를 추가하거나 해제합니다.":"저장된 연결이 자동 반영됩니다 · 노드를 클릭하면 해당 위치로 이동";
    elements.graphStage?.classList.toggle("is-marking-locations",marking);
    $$("[data-scene-id]",elements.graphCanvas).forEach(node=>{
      const scene=state.scenes.get(node.dataset.sceneId);
      if(scene)updateGraphMarkVisual(node,scene);
    });
  }

  async function handleGraphNodeClick(id) {
    if(!(state.admin&&state.markingLocations)) {
      closeDialog("node-graph-dialog");
      return navigate(id);
    }
    const scene=state.scenes.get(id);
    if(!scene||graphMarkPending.has(id))return;
    const confirmed=!Boolean(scene.locationConfirmed);
    graphMarkPending.add(id);
    syncGraphMarkMode();
    $("#graph-mark-status").textContent=arrowNodeLabel(scene)+" · 저장 중…";
    try {
      const result=await api(`/api/admin/scenes/${encodeURIComponent(id)}/confirmation`,{method:"PUT",body:{confirmed}});
      graphLocationChanges.set(id,{confirmed:result.confirmed,revision:++graphLocationRevision});
      const current=state.scenes.get(id);
      if(current)current.locationConfirmed=result.confirmed?1:0;
      $("#graph-mark-status").textContent=arrowNodeLabel(scene)+(result.confirmed?" · 확인 표시 저장됨":" · 확인 표시 해제됨");
    } catch(error) {
      $("#graph-mark-status").textContent=error.message;
      toast(error.message,"error");
    } finally {
      graphMarkPending.delete(id);
      syncGraphMarkMode();
    }
  }

  async function openNodeGraph() {
    $("#graph-building").value=state.scenes.get(state.currentSceneId)?.building||"본관";
    openDialog("node-graph-dialog");
    requestAnimationFrame(renderNodeGraph);
  }
  function bindGraphPanning(stage) {
    let drag = null;
    stage.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || event.target.closest("button, select, input, a")) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("is-panning");
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      stage.scrollLeft -= event.clientX - drag.x;
      stage.scrollTop -= event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
    });
    const end = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null;
      stage.classList.remove("is-panning");
      stage.releasePointerCapture(event.pointerId);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }
  bindGraphPanning(elements.graphStage);
  $("#graph-building").addEventListener("change",renderNodeGraph);
  $("#graph-mark-mode").addEventListener("click",()=>{
    if(!state.admin)return;
    state.markingLocations=!state.markingLocations;
    $("#graph-mark-status").textContent="";
    syncGraphMarkMode();
  });
  $("#node-graph-dialog").addEventListener("close",()=>{
    state.markingLocations=false;
    $("#graph-mark-status").textContent="";
    syncGraphMarkMode();
  });

  $("#enter-button").addEventListener("click", () => {
    window.DSHSOpening?.release();
    backgroundMusic.start();
    elements.welcome.classList.add("is-entered");
    setTimeout(() => {
      elements.welcome.hidden = true;
      elements.canvas.focus();
    }, 780);
  });
  $("#brand-button").addEventListener("click", () => openDialog("about-dialog"));
  const menuButton = $("#tour-menu-button");
  const tourMenu = $("#tour-menu");
  viewer.setPlaceholderHue(268);
  try { localStorage.removeItem("dshs-color-theme"); } catch {}
  function setTourMenu(open) {
    tourMenu.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  }
  menuButton.addEventListener("click", () => setTourMenu(tourMenu.hidden));
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".tour-menu-wrap")) setTourMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !tourMenu.hidden) { setTourMenu(false); menuButton.focus(); }
  });
  async function loadVisits(method = "GET") {
    try {
      const response = await fetch("/api/visits", { method, cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Unavailable");
      const { count } = await response.json();
      $("#visit-count").textContent = new Intl.NumberFormat("ko-KR").format(count) + "회";
    } catch {
      $("#visit-count").textContent = "집계 불러오기 실패";
    }
  }
  const visitRegistration = loadVisits("POST");
  $$("[data-info-dialog]").forEach((button) => button.addEventListener("click", () => {
    setTourMenu(false);
    openDialog(button.dataset.infoDialog);
    if (button.dataset.infoDialog === "site-info-dialog") visitRegistration.then(() => loadVisits());
  }));
  function selectCreatorGeneration(generation) {
    $$("[data-creator-tab]").forEach(button => {
      const selected = button.dataset.creatorTab === generation;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      $("#creators-generation-" + button.dataset.creatorTab).hidden = !selected;
    });
  }
  $$("[data-creator-tab]").forEach(button => {
    button.addEventListener("click", () => selectCreatorGeneration(button.dataset.creatorTab));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = button.dataset.creatorTab === "1" ? "2" : "1";
      selectCreatorGeneration(next);
      $("#creators-tab-" + next).focus();
    });
  });
  $$("[data-open-creators]").forEach((button) => button.addEventListener("click", () => {
    selectCreatorGeneration("1");
    openDialog("creators-dialog");
  }));
  $("#fullscreen-button").addEventListener("click", () => {
    if (!document.fullscreenElement) $("#app").requestFullscreen?.(); else document.exitFullscreen?.();
  });
  $("#zoom-in").addEventListener("click", () => viewer.zoom(-8));
  $("#zoom-out").addEventListener("click", () => viewer.zoom(8));
  $("#reset-view").addEventListener("click", () => {
    const scene = state.scenes.get(state.currentSceneId);
    if (scene) viewer.setView(scene.initialYaw, scene.initialPitch, 84);
  });
  viewer.addEventListener("viewchange", updateAdminReadout);

  elements.adminButton.addEventListener("click", () => {
    if (state.admin) elements.adminDock.classList.toggle("is-collapsed");
    else openDialog("login-dialog");
  });
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
  $$("dialog.modal").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type=submit]", form);
    const errorLine = $("#login-error");
    errorLine.textContent = "";
    button.disabled = true;
    try {
      const result = await api("/api/admin/login", { method: "POST", body: { password: form.elements.password.value } });
      form.reset();
      setAdminMode(true, result.csrf);
      closeDialog("login-dialog");
      toast("편집 모드가 활성화되었습니다.", "success");
    } catch (error) { errorLine.textContent = error.message; }
    finally { button.disabled = false; }
  });

  elements.adminDock.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-admin-action]")?.dataset.adminAction;
    if (!action) return;
    if (action === "upload") openUpload();
    if (action === "connect") openConnect();
    if (action === "arrows") openArrowEditor();
    if (action === "graph") openNodeGraph();
    if (action === "edit") openEdit();
    if (action === "links") openLinkManager();
    if (action === "logout") {
      try { await api("/api/admin/logout", { method: "POST", body: {} }); } catch { /* expire locally too */ }
      setAdminMode(false, null);
      toast("편집 모드를 종료했습니다.");
    }
  });

  $("#upload-new-node").addEventListener("click",()=>{
    const form=$("#upload-form");form.elements.id.value=nextNodeId();form.elements.replace.value="false";form.elements.title.value="";
    $("#upload-new-node").hidden=true;
  });
  $("#connect-target").addEventListener("change",()=>{
    $("#connect-form").elements.label.value=state.scenes.get($("#connect-target").value)?.title||"이동";
  });
  $("#connect-pick").addEventListener("click", () => {
    placingArrow = true;
    arrowPreview = null;
    hideCursorArrow();
    closeDialog("connect-dialog");
    $("#arrow-placement").hidden = false;
    $("#arrow-placement-status").textContent = "화살표를 놓을 바닥을 클릭하세요";
    $("#arrow-placement-save").disabled = true;
    document.body.classList.add("placing-arrow");
    setViewerLinks();
  });
  viewer.addEventListener("panorama-click", (event) => {
    if (arrowEditor.active) {
      void arrowEditor.place(viewer.worldToImageAngles(event.detail));
      return;
    }
    if (!placingArrow) {
      if (state.navigating) return;
      const point=event.detail;
      const link=window.PanoramaViewer.pickNavigationLink(viewer.hotspots,viewer.getView(),point.x,point.y,point.width,point.height);
      if (!link) { hideCursorArrow(); return; }
      if (point.pointerType==="touch" && touchSelectedSceneId!==link.toScene) {
        touchSelectedSceneId=link.toScene;
        showCursorArrow(link,point,true);
        return;
      }
      navigate(link.toScene);
      return;
    }
    if (!state.admin) return;
    const { yaw, pitch } = viewer.worldToImageAngles(event.detail);
    $("#connect-yaw").value = String(yaw);
    $("#connect-pitch").value = String(pitch);
    arrowPreview = { yaw, pitch };
    $("#arrow-placement-status").textContent = "이 위치에 화살표를 놓습니다";
    $("#arrow-placement-save").disabled = false;
    $("#connect-save").disabled = false;
    setViewerLinks();
  });
  viewer.addEventListener("panorama-hover", (event) => {
    if (arrowEditor.active || placingArrow || state.navigating || !state.currentSceneId) { hideCursorArrow(); return; }
    const point=event.detail;
    const link=window.PanoramaViewer.pickNavigationLink(viewer.hotspots,viewer.getView(),point.x,point.y,point.width,point.height);
    if (link) showCursorArrow(link,point);
    else hideCursorArrow();
  });
  viewer.addEventListener("panorama-leave", hideCursorArrow);
  $("#arrow-placement-cancel").addEventListener("click", cancelArrowPlacement);
  $("#arrow-placement-save").addEventListener("click", () => $("#connect-form").requestSubmit());
  viewer.addEventListener("imageerror", (event) => toast(event.detail.message, "error"));
  $("#upload-form").elements.panorama.addEventListener('change', event => {
    const insp = /\.insp$/i.test(event.target.files[0]?.name || '');
    $("#insp-hint").hidden = !insp;
    $("#upload-status").textContent = '';
  });
  $("#upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type=submit]", form);
    const data = new FormData(form);
    data.set("id", String(data.get("id")).trim().toUpperCase());
    button.disabled = true;
    button.textContent = "이미지 변환 중…";
    const progress = $("#upload-progress");
    progress.hidden = true;
    progress.removeAttribute("value");
    try {
      await window.preparePanoramaUpload(data, text => { button.textContent = text; $("#upload-status").textContent = text; });
      button.textContent = '업로드 중…';
      progress.hidden = false;
      const result = await window.sendPanoramaUpload(data, { csrf: state.csrf, progress: event => {
        if (event.phase === "saving") {
          progress.value = 100;
          button.textContent = '사진 저장 중…';
          $("#upload-status").textContent = '전송 완료 · 사진을 저장하고 있습니다…';
        } else if (event.total) {
          const percent = Math.min(100, Math.round(event.loaded / event.total * 100));
          progress.value = percent;
          button.textContent = `전송 중 ${percent}%`;
          $("#upload-status").textContent = `${(event.loaded / 1024 / 1024).toFixed(1)} / ${(event.total / 1024 / 1024).toFixed(1)} MB 전송 중`;
        } else $("#upload-status").textContent = `${(event.loaded / 1024 / 1024).toFixed(1)} MB 전송 중…`;
      } });
      await viewer.primeUpload(result.scene.image4k, data.get('image4k')).catch(() => {});
      closeDialog("upload-dialog");
      const scene = state.scenes.get(result.scene.id);
      if (scene) {
        Object.assign(scene, { image8k: result.scene.image8k, image4k: result.scene.image4k, thumb: result.scene.thumb,
          initialYaw: result.scene.initialYaw, initialPitch: result.scene.initialPitch });
        await navigate(scene.id);
      } else await refreshAfterEdit(result.scene.id);
      toast("파노라마 사진을 저장했습니다.", "success");
    } catch (error) { $("#upload-status").textContent = error.message; toast(error.message, "error"); }
    finally { progress.hidden = true; button.disabled = false; button.textContent = "업로드 및 변환"; }
  });

  $("#connect-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const reverse = form.elements.reverse.checked;
    delete data.reverse;
    data.yaw = Number(data.yaw);
    data.pitch = Number(data.pitch);
    const button = $("button[type=submit]", form);
    button.disabled = true;
    try {
      if(form.dataset.linkId) {
        await api("/api/admin/links/"+form.dataset.linkId,{method:"PUT",body:data});
      } else if (reverse) {
        const current = state.scenes.get(data.fromScene);
        await api("/api/admin/links/pair", { method:"POST", body:{
          fromScene:data.fromScene,toScene:data.toScene,fromYaw:data.yaw,fromPitch:data.pitch,
          toYaw:normalizeYaw(data.yaw+180),toPitch:data.pitch,fromLabel:data.label,toLabel:current?.title||data.fromScene,kind:data.kind
        }});
      } else {
        await api("/api/admin/links",{method:"POST",body:data});
      }
      closeDialog("connect-dialog");
      cancelArrowPlacement();
      await refreshAfterEdit();
      toast(reverse ? "양방향 노드 연결을 만들었습니다." : "노드 연결을 만들었습니다.", "success");
    } catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; }
  });

  $("#edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const scene = state.scenes.get(state.currentSceneId);
    const view = viewer.getView();
    const useView = $("#use-current-view").checked;
    const body = {
      title: form.elements.title.value,
      floor: form.elements.floor.value,
      building: form.elements.building.value,
      nodeType: form.elements.nodeType.value,
      initialYaw: useView ? view.yaw : scene.initialYaw,
      initialPitch: useView ? view.pitch : scene.initialPitch,
    };
    try {
      body.imageYaw = Number(form.elements.imageYaw.value);
      body.imagePitch = Number(form.elements.imagePitch.value);
      const saved = await api(`/api/admin/scenes/${encodeURIComponent(scene.id)}`, { method: "PUT", body });
      Object.assign(scene, { initialYaw:saved.initialYaw,initialPitch:saved.initialPitch,imageYaw:saved.imageYaw,imagePitch:saved.imagePitch });
      closeDialog("edit-dialog");
      await refreshAfterEdit(scene.id);
      viewer.setView(view.yaw, view.pitch, view.hfov);
      toast("노드 설정을 저장했습니다.", "success");
    } catch (error) { toast(error.message, "error"); }
  });

  function previewImageOrientation() {
    if (!$("#edit-dialog").open || $("#edit-id").value !== state.currentSceneId) return;
    const yawText=$("#edit-image-yaw").value,pitchText=$("#edit-image-pitch").value;
    if (yawText === "" || pitchText === "") return;
    const yaw=Number(yawText),pitch=Number(pitchText);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || Math.abs(yaw)>360 || Math.abs(pitch)>90) return;
    viewer.setImageOrientation(yaw,pitch);
    setViewerLinks();
  }
  $("#edit-image-yaw").addEventListener("input",previewImageOrientation);
  $("#edit-image-pitch").addEventListener("input",previewImageOrientation);
  $("#edit-dialog").addEventListener("close",()=>{
    const scene=state.scenes.get(state.currentSceneId);
    if (scene) { viewer.setImageOrientation(scene.imageYaw||0,scene.imagePitch||0); setViewerLinks(); }
  });

  $("#set-start-scene").addEventListener("click", async () => {
    try {
      await api("/api/admin/start-scene", { method: "POST", body: { id: state.currentSceneId } });
      await loadTour();
      toast("현재 노드를 첫 화면으로 지정했습니다.", "success");
    } catch (error) { toast(error.message, "error"); }
  });

  $("#delete-scene").addEventListener("click", async () => {
    const scene = state.scenes.get(state.currentSceneId);
    if (!scene || !confirm(`‘${scene.title}’ 노드와 연결을 모두 삭제할까요?`)) return;
    try {
      await api(`/api/admin/scenes/${encodeURIComponent(scene.id)}`, { method: "DELETE" });
      closeDialog("edit-dialog");
      await refreshAfterEdit();
      toast("노드를 삭제했습니다.");
    } catch (error) { toast(error.message, "error"); }
  });

  window.addEventListener("hashchange", () => {
    const id = new URLSearchParams(location.hash.slice(1)).get("scene");
    if (id && id !== state.currentSceneId && state.scenes.has(id)) navigate(id, { replaceHash: false });
  });

  async function boot() {
    try {
      const [session] = await Promise.all([
        api("/api/admin/session"),
        loadTour(),
      ]);
      if (session.authenticated) setAdminMode(true, session.csrf);
      const requested = new URLSearchParams(location.hash.slice(1)).get("scene");
      const start = state.scenes.has(requested) ? requested : state.tour.scenes.find((scene) => scene.isStart)?.id || state.tour.scenes[0]?.id;
      if (!start) throw new Error("공개된 파노라마 노드가 없습니다.");
      await navigate(start);
      $("#welcome-loader").hidden = true;
      $("#enter-button").hidden = false;
    } catch (error) {
      elements.loading.hidden = false;
      elements.loading.innerHTML = `<p>${error.message}</p>`;
      $("#welcome-loader").hidden = true;
      $("#welcome-error").textContent = "투어를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.";
      $("#welcome-error").hidden = false;
    }
  }

  boot();
})();
