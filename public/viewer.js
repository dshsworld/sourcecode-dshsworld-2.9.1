"use strict";

(function () {
  const DEG = Math.PI / 180;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const normalizeYaw = (yaw) => ((yaw + 180) % 360 + 360) % 360 - 180;

  class PanoramaViewer extends EventTarget {
    static rotateDirection([x,y,z], { yaw = 0, pitch = 0 } = {}, inverse = false) {
      const a=yaw*DEG,b=pitch*DEG,cy=Math.cos(a),sy=Math.sin(a),cp=Math.cos(b),sp=Math.sin(b);
      if (inverse) {
        const xx=cy*x-sy*z,zz=sy*x+cy*z;
        return [xx,cp*y-sp*zz,sp*y+cp*zz];
      }
      const yy=cp*y+sp*z,zz=-sp*y+cp*z;
      return [cy*x+sy*zz,yy,-sy*x+cy*zz];
    }

    static rotateAngles(point, rotation = {}, inverse = false) {
      if (!(Number(rotation.yaw)||0) && !(Number(rotation.pitch)||0)) return { yaw:point.yaw,pitch:point.pitch };
      const y=point.yaw*DEG,p=point.pitch*DEG;
      const [x,yy,z]=PanoramaViewer.rotateDirection([Math.cos(p)*Math.sin(y),Math.sin(p),Math.cos(p)*Math.cos(y)],rotation,inverse);
      return { yaw:normalizeYaw(Math.atan2(x,z)/DEG),pitch:Math.atan2(yy,Math.hypot(x,z))/DEG };
    }

    static pointToAngles(view, x, y, width, height) {
      const yaw = view.yaw * DEG, pitch = view.pitch * DEG;
      const tanH = Math.tan(view.hfov * DEG / 2);
      const dx = (2 * x / width - 1) * tanH;
      const dy = (1 - 2 * y / height) * tanH * height / width;
      const direction = [
        Math.cos(pitch) * Math.sin(yaw) + dx * Math.cos(yaw) - dy * Math.sin(pitch) * Math.sin(yaw),
        Math.sin(pitch) + dy * Math.cos(pitch),
        Math.cos(pitch) * Math.cos(yaw) - dx * Math.sin(yaw) - dy * Math.sin(pitch) * Math.cos(yaw),
      ];
      return { yaw: normalizeYaw(Math.atan2(direction[0], direction[2]) / DEG), pitch: Math.atan2(direction[1], Math.hypot(direction[0], direction[2])) / DEG };
    }

    static pickNavigationLink(links, view, x, y, width, height) {
      if (!width || !height || y < height * .52) return null;
      const { yaw, pitch } = PanoramaViewer.pointToAngles(view, x, y, width, height);
      if (pitch > -2) return null;
      const candidates = links.filter(link => link.kind !== "preview" && Number.isFinite(Number(link.yaw)))
        .map(link => ({ link, difference: Math.abs(normalizeYaw(Number(link.yaw) - yaw)) }))
        .sort((a, b) => a.difference - b.difference);
      const nearest = candidates[0];
      if (!nearest || nearest.difference > Math.min(26, view.hfov * .38)) return null;
      if (candidates[1] && candidates[1].link.toScene !== nearest.link.toScene && candidates[1].difference - nearest.difference < 7) return null;
      return nearest.link;
    }

    static arrivalView(scene, returnLink) {
      const back=returnLink && PanoramaViewer.rotateAngles(returnLink,{yaw:scene.imageYaw||0,pitch:scene.imagePitch||0});
      return { yaw: back ? normalizeYaw(back.yaw + 180) : scene.initialYaw, pitch: scene.initialPitch, hfov: 84 };
    }

    static createImageCache(limit = 4) {
      const entries = new Map();
      return {
        ready(url) { return entries.get(url)?.image || null; },
        prime(url, image) {
          entries.delete(url);
          entries.set(url, { image, promise: Promise.resolve(image) });
          while (entries.size > limit) entries.delete(entries.keys().next().value);
        },
        load(url) {
          if (!url) return Promise.reject(new Error("사진 주소가 없습니다."));
          const existing = entries.get(url);
          if (existing) {
            entries.delete(url);
            entries.set(url, existing);
            return existing.promise;
          }
          const image = new Image();
          image.decoding = "async";
          const entry = {};
          entry.promise = new Promise((resolve, reject) => {
            image.onload = () => {
              Promise.resolve(image.decode?.()).catch(() => {}).then(() => { entry.image = image; resolve(image); });
            };
            image.onerror = () => { entries.delete(url); reject(new Error("파노라마 이미지를 불러오지 못했습니다.")); };
          });
          entries.set(url, entry);
          while (entries.size > limit) entries.delete(entries.keys().next().value);
          image.src = url;
          return entry.promise;
        },
      };
    }

    // Keep creator-placed anchors at their exact photo coordinates. Only
    // estimated legacy arrows may be moved to avoid overlapping targets.
    static layoutHotspots(points, width, height) {
      const placed = points.filter(point => point.pinned).map(point => ({ ...point })), gap = 84, margin = 42;
      for (const point of points) {
        if (point.pinned) continue;
        const x = clamp(point.x, margin, Math.max(margin, width - margin));
        const y = clamp(point.y, margin, Math.max(margin, height - margin));
        const candidates = [{ x, y }];
        for (let dx = -Math.ceil(width / gap); dx <= Math.ceil(width / gap); dx++) {
          for (let dy = -Math.ceil(height / gap); dy <= Math.ceil(height / gap); dy++) {
            const cx = x + dx * gap, cy = y + dy * gap;
            if (cx >= margin && cx <= width - margin && cy >= margin && cy <= height - margin) candidates.push({ x: cx, y: cy });
          }
        }
        candidates.sort((a, b) => (a.x-x)**2+(a.y-y)**2 - ((b.x-x)**2+(b.y-y)**2));
        const spot = candidates.find(a => placed.every(b => Math.abs(a.x-b.x) >= gap-1 || Math.abs(a.y-b.y) >= gap-1)) || {x,y};
        placed.push({ ...point, ...spot });
      }
      const byIndex = new Map(placed.map(point => [point.index, point]));
      return points.map(point => byIndex.get(point.index));
    }

    constructor(canvas, hotspotLayer) {
      super();
      this.canvas = canvas;
      this.hotspotLayer = hotspotLayer;
      this.gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
      if (!this.gl) throw new Error("이 기기에서는 WebGL을 사용할 수 없습니다.");
      this.yaw = 0;
      this.pitch = 0;
      this.hfov = 84;
      this.imageOrientation = { yaw:0,pitch:0 };
      this.hotspots = [];
      this.hotspotElements = [];
      this.pointer = null;
      this.dirty = true;
      this.textureReady = false;
      this.placeholderHue = 268;
      this.placeholderSource = null;
      this.imageCache = PanoramaViewer.createImageCache();
      this.loadSequence = 0;
      this.#createProgram();
      this.#bindEvents();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
      this.#loop();
    }

    #compile(type, source) {
      const shader = this.gl.createShader(type);
      this.gl.shaderSource(shader, source);
      this.gl.compileShader(shader);
      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) throw new Error(this.gl.getShaderInfoLog(shader));
      return shader;
    }

    #createProgram() {
      const vertex = `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
          v_uv = (a_position + 1.0) * 0.5;
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `;
      const fragment = `
        precision highp float;
        varying vec2 v_uv;
        uniform sampler2D u_panorama;
        uniform vec3 u_forward;
        uniform vec3 u_right;
        uniform vec3 u_up;
        uniform vec2 u_tan;
        const float PI = 3.141592653589793;
        void main() {
          vec2 plane = v_uv * 2.0 - 1.0;
          vec3 direction = normalize(u_forward + u_right * plane.x * u_tan.x + u_up * plane.y * u_tan.y);
          float u = atan(direction.x, direction.z) / (2.0 * PI) + 0.5;
          float v = asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5;
          gl_FragColor = texture2D(u_panorama, vec2(fract(u), v));
        }
      `;
      const gl = this.gl;
      const program = gl.createProgram();
      gl.attachShader(program, this.#compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, this.#compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      this.program = program;
      this.uniforms = {
        forward: gl.getUniformLocation(program, "u_forward"),
        right: gl.getUniformLocation(program, "u_right"),
        up: gl.getUniformLocation(program, "u_up"),
        tan: gl.getUniformLocation(program, "u_tan"),
      };
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      // WebGL 1 requires CLAMP_TO_EDGE for non-power-of-two photos.
      // Longitude already wraps with fract(u) in the fragment shader.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    #bindEvents() {
      this.canvas.addEventListener("pointerdown", (event) => {
        this.canvas.setPointerCapture(event.pointerId);
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
        this.canvas.classList.add("is-dragging");
        if (event.pointerType !== "touch") this.dispatchEvent(new Event("panorama-leave"));
      });
      this.canvas.addEventListener("pointermove", (event) => {
        if (!this.pointer) {
          if (event.pointerType === "mouse" || event.pointerType === "pen") {
            const box = this.canvas.getBoundingClientRect();
            this.dispatchEvent(new CustomEvent("panorama-hover", { detail: { x: event.clientX - box.left, y: event.clientY - box.top, width: box.width, height: box.height } }));
          }
          return;
        }
        if (this.pointer.id !== event.pointerId) return;
        const dx = event.clientX - this.pointer.x;
        const dy = event.clientY - this.pointer.y;
        if (!this.pointer.moved && Math.hypot(event.clientX - this.pointer.startX, event.clientY - this.pointer.startY) > 8) {
          this.pointer.moved = true;
          this.dispatchEvent(new Event("panorama-leave"));
        }
        const scale = this.hfov / Math.max(420, this.canvas.clientWidth);
        this.yaw = normalizeYaw(this.yaw - dx * scale);
        this.pitch = clamp(this.pitch + dy * scale, -82, 82);
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
        this.invalidate(true);
      });
      const endPointer = () => { this.pointer = null; this.canvas.classList.remove("is-dragging"); };
      this.canvas.addEventListener("pointerup", (event) => {
        if (this.pointer?.id === event.pointerId && !this.pointer.moved) {
          const box = this.canvas.getBoundingClientRect();
          const angles = PanoramaViewer.pointToAngles(this.getView(), event.clientX - box.left, event.clientY - box.top, box.width, box.height);
          this.dispatchEvent(new CustomEvent("panorama-click", { detail: { ...angles, x: event.clientX - box.left, y: event.clientY - box.top, width: box.width, height: box.height, pointerType: event.pointerType } }));
        }
        endPointer();
      });
      this.canvas.addEventListener("pointercancel", endPointer);
      this.canvas.addEventListener("pointerleave", (event) => {
        if (event.pointerType !== "touch") this.dispatchEvent(new Event("panorama-leave"));
      });
      this.canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        this.hfov = clamp(this.hfov + Math.sign(event.deltaY) * 7, 42, 110);
        this.invalidate(true);
      }, { passive: false });
      this.canvas.addEventListener("keydown", (event) => {
        const action = {
          ArrowLeft: () => { this.yaw = normalizeYaw(this.yaw - 5); },
          ArrowRight: () => { this.yaw = normalizeYaw(this.yaw + 5); },
          ArrowUp: () => { this.pitch = clamp(this.pitch + 4, -82, 82); },
          ArrowDown: () => { this.pitch = clamp(this.pitch - 4, -82, 82); },
          "+": () => { this.hfov = clamp(this.hfov - 7, 42, 110); },
          "-": () => { this.hfov = clamp(this.hfov + 7, 42, 110); },
        }[event.key];
        if (action) { event.preventDefault(); action(); this.invalidate(true); }
      });
      document.addEventListener("fullscreenchange", () => this.resize());
    }

    maxTextureSize() {
      return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    }

    setPlaceholderHue(hue) {
      this.placeholderHue = Number.isFinite(Number(hue)) ? Number(hue) : 268;
      if (this.placeholderSource) this.#uploadPlaceholder(this.placeholderSource);
    }

    #uploadPlaceholder(image) {
      const surface = document.createElement("canvas");
      surface.width = image.naturalWidth;
      surface.height = image.naturalHeight;
      const context = surface.getContext("2d");
      context.drawImage(image, 0, 0);
      context.globalCompositeOperation = "color";
      context.fillStyle = `hsl(${this.placeholderHue} 85% 55%)`;
      context.fillRect(0, 0, surface.width, surface.height);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, surface);
      this.invalidate(true);
    }

    preload(imageUrl) { return this.imageCache.load(imageUrl); }

    #showImage(image, placeholder, view, resetView) {
      const max = this.maxTextureSize();
      if (image.naturalWidth > max || image.naturalHeight > max) throw new Error(`이미지가 이 기기의 한계(${max}px)를 넘습니다.`);
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      if (placeholder) this.#uploadPlaceholder(image);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('사진을 화면에 표시하지 못했습니다. 페이지를 새로고침해 주세요.');
      this.placeholderSource = placeholder ? image : null;
      if (resetView) {
        this.yaw = normalizeYaw(Number(view.yaw) || 0);
        this.pitch = clamp(Number(view.pitch) || 0, -82, 82);
        this.hfov = clamp(Number(view.hfov) || 84, 42, 110);
      }
      this.textureReady = true;
      this.invalidate(true);
    }

    async load(imageUrl, view = {}, previewUrl = null) {
      const sequence = ++this.loadSequence;
      const placeholder = !imageUrl;
      if (placeholder) imageUrl = "/assets/demo/f1-hall.webp";
      const ready = this.imageCache.ready(imageUrl);
      if (ready) { this.#showImage(ready, placeholder, view, true); return; }
      const full = this.imageCache.load(imageUrl);
      full.catch(() => {});
      if (!previewUrl || placeholder) {
        const image = await full;
        if (sequence === this.loadSequence) this.#showImage(image, placeholder, view, true);
        return;
      }
      let previewShown = false;
      try {
        const preview = await this.imageCache.load(previewUrl);
        if (sequence !== this.loadSequence) return;
        if (!this.imageCache.ready(imageUrl)) {
          this.#showImage(preview, false, view, true);
          previewShown = true;
        }
      } catch { /* A broken thumbnail should not prevent the main image. */ }
      if (!previewShown) {
        const image = await full;
        if (sequence === this.loadSequence) this.#showImage(image, false, view, true);
        return;
      }
      full.then((image) => {
        if (sequence === this.loadSequence) this.#showImage(image, false, view, false);
      }).catch((error) => {
        if (sequence === this.loadSequence) this.dispatchEvent(new CustomEvent("imageerror", { detail: error }));
      });
    }

    async primeUpload(url, blob) {
      if (!url || !(blob instanceof Blob)) return;
      const localUrl = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.decoding = "async";
        await new Promise((resolve, reject) => {
          image.onload = () => Promise.resolve(image.decode?.()).catch(() => {}).then(resolve);
          image.onerror = () => reject(new Error("사진 미리보기를 준비하지 못했습니다."));
          image.src = localUrl;
        });
        this.imageCache.prime(url, image);
      } finally { URL.revokeObjectURL(localUrl); }
    }

    setHotspots(hotspots) {
      this.hotspots = hotspots;
      this.hotspotLayer.replaceChildren();
      this.hotspotElements = hotspots.map((hotspot) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `hotspot hotspot-${hotspot.kind || "walk"}`;
        button.classList.toggle("hotspot-selected", Boolean(hotspot.selected));
        button.setAttribute("aria-label", hotspot.label);
        button.innerHTML = `<span class="hotspot-icon" aria-hidden="true"><i></i></span>`;
        if (hotspot.displayLabel) {
          const label = document.createElement("span");
          label.className = "hotspot-label";
          label.textContent = hotspot.displayLabel;
          button.append(label);
        }
        button.addEventListener("click", (event) => { event.stopPropagation(); hotspot.onClick?.(hotspot); });
        this.hotspotLayer.append(button);
        return button;
      });
      this.invalidate();
    }

    setView(yaw, pitch, hfov = this.hfov) {
      this.yaw = normalizeYaw(yaw);
      this.pitch = clamp(pitch, -82, 82);
      this.hfov = clamp(hfov, 42, 110);
      this.invalidate(true);
    }

    getView() { return { yaw: this.yaw, pitch: this.pitch, hfov: this.hfov }; }
    setImageOrientation(yaw = 0, pitch = 0) {
      this.imageOrientation = { yaw:Number(yaw)||0,pitch:Number(pitch)||0 };
      this.invalidate();
    }
    imageToWorldAngles(point) { return PanoramaViewer.rotateAngles(point,this.imageOrientation); }
    worldToImageAngles(point) { return PanoramaViewer.rotateAngles(point,this.imageOrientation,true); }
    zoom(delta) { this.hfov = clamp(this.hfov + delta, 42, 110); this.invalidate(true); }

    resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
      }
      this.invalidate();
    }

    invalidate(emit = false) {
      this.dirty = true;
      if (emit) this.dispatchEvent(new CustomEvent("viewchange", { detail: this.getView() }));
    }

    #basis() {
      const yaw = this.yaw * DEG;
      const pitch = this.pitch * DEG;
      return {
        forward: [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)],
        right: [Math.cos(yaw), 0, -Math.sin(yaw)],
        up: [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)],
      };
    }

    #updateHotspots(basis, tanH, tanV) {
      const projected = [];
      this.hotspots.forEach((hotspot, index) => {
        const yaw = hotspot.yaw * DEG;
        const pitch = hotspot.pitch * DEG;
        const direction = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const x = dot(direction, basis.right);
        const y = dot(direction, basis.up);
        const z = dot(direction, basis.forward);
        const sx = 0.5 + (x / Math.max(z, 0.001)) / (2 * tanH);
        const sy = 0.5 - (y / Math.max(z, 0.001)) / (2 * tanV);
        const visible = z > 0.08 && sx > -0.08 && sx < 1.08 && sy > -0.12 && sy < 1.12;
        const element = this.hotspotElements[index];
        element.hidden = !visible;
        if (visible) {
          projected.push({index, x:sx * this.canvas.clientWidth, y:sy * this.canvas.clientHeight, z, pinned:hotspot.pinned || hotspot.positioned === 2});
        }
      });
      for (const point of PanoramaViewer.layoutHotspots(projected, this.canvas.clientWidth, this.canvas.clientHeight)) {
        const element = this.hotspotElements[point.index];
        element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%) scale(${clamp(1.18 - point.z * .18, .86, 1.1)})`;
        element.style.zIndex = String(this.hotspots[point.index].selected ? 200 : Math.round(point.z * 100));
      }
    }

    #render() {
      if (!this.textureReady) return;
      const gl = this.gl;
      const basis = this.#basis();
      const imageBasis = Object.fromEntries(Object.entries(basis).map(([key,direction])=>[key,PanoramaViewer.rotateDirection(direction,this.imageOrientation,true)]));
      const tanH = Math.tan(this.hfov * DEG / 2);
      const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
      const tanV = tanH / aspect;
      gl.useProgram(this.program);
      gl.uniform3fv(this.uniforms.forward, imageBasis.forward);
      gl.uniform3fv(this.uniforms.right, imageBasis.right);
      gl.uniform3fv(this.uniforms.up, imageBasis.up);
      gl.uniform2f(this.uniforms.tan, tanH, tanV);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.#updateHotspots(basis, tanH, tanV);
    }

    #loop() {
      if (this.dirty) { this.dirty = false; this.#render(); }
      requestAnimationFrame(() => this.#loop());
    }
  }

  window.PanoramaViewer = PanoramaViewer;
})();
