// Prepare browser-ready panoramas locally; the server validates and stores them.
(function () {
  const MAX_SOURCE_BYTES = 48 * 1024 * 1024;
  const MAX_BODY_BYTES = 62 * 1024 * 1024;

  function jpegSize(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        };
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) break;
      offset += 2 + length;
    }
    return null;
  }

  function imageMime(header) {
    if (header[0] === 255 && header[1] === 216) return 'image/jpeg';
    if (header[0] === 137 && header[1] === 80) return 'image/png';
    if (String.fromCharCode(...header.slice(8, 12)) === 'WEBP') return 'image/webp';
    return '';
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('웹용 사진 생성에 실패했습니다. 다시 시도해 주세요.')), 'image/jpeg', quality);
    });
  }

  function scaledCanvas(source, width) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, source.width);
    canvas.height = Math.round(canvas.width / 2);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지 처리 메모리가 부족합니다. 다른 탭을 닫고 다시 시도해 주세요.');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function dimensionsFor(bytes, mime) {
    if (mime === 'image/jpeg') return jpegSize(bytes);
    if (mime === 'image/png' && bytes.length >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mime === 'image/webp' && bytes.length >= 30) {
      const kind = String.fromCharCode(...bytes.slice(12, 16));
      const u24 = offset => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
      if (kind === 'VP8X') return { width: 1 + u24(24), height: 1 + u24(27) };
      if (kind === 'VP8 ') return { width: (bytes[26] | bytes[27] << 8) & 16383, height: (bytes[28] | bytes[29] << 8) & 16383 };
      if (kind === 'VP8L' && bytes[20] === 47) return { width: 1 + (bytes[21] | (bytes[22] & 63) << 8), height: 1 + ((bytes[22] >> 6) | bytes[23] << 2 | (bytes[24] & 15) << 10) };
    }
    return null;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader) || 'unknown shader error';
      gl.deleteShader(shader);
      throw new Error(`360° 변환기를 시작할 수 없습니다. (${reason})`);
    }
    return shader;
  }

  async function resizedBitmap(file, mime, width, height) {
    const blob = file.slice(0, file.size, mime);
    try {
      return await createImageBitmap(blob, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
        imageOrientation: 'none',
      });
    } catch {
      const original = await createImageBitmap(blob);
      if (original.width <= width) return original;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) { original.close(); throw new Error('INSP 사진을 변환할 메모리가 부족합니다. 다른 탭을 닫고 다시 시도해 주세요.'); }
      context.drawImage(original, 0, 0, width, height);
      original.close();
      const result = await createImageBitmap(canvas);
      canvas.width = canvas.height = 1;
      return result;
    }
  }

  async function stitchDualFisheye(file, dimensions, progress) {
    progress('INSP 렌즈 사진 분석 중…');
    const canvas = document.createElement('canvas');
    let gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('이 브라우저에서는 INSP 360° 변환을 실행할 수 없습니다. Chrome 또는 Edge 최신 버전에서 다시 시도해 주세요.');

    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const supportedWidth = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), viewport[0], viewport[1] * 2);
    const outputWidth = supportedWidth >= 8192 ? 8192 : supportedWidth >= 4096 ? 4096 : supportedWidth >= 2048 ? 2048 : 0;
    if (!outputWidth) throw new Error('이 기기의 그래픽 처리 한도가 너무 낮아 INSP를 변환할 수 없습니다. 다른 컴퓨터에서 다시 시도해 주세요.');
    canvas.width = outputWidth;
    canvas.height = outputWidth / 2;

    // Changing the drawing-buffer size resets WebGL state, so initialize after sizing.
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    const inputWidth = Math.min(dimensions.width, outputWidth, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const inputHeight = Math.round(inputWidth * dimensions.height / dimensions.width);
    const bitmap = await resizedBitmap(file, 'image/jpeg', inputWidth, inputHeight);

    try {
      progress(`INSP를 ${outputWidth === 8192 ? '8K' : '4K'} 360° 파노라마로 변환 중…`);
      const vertex = compileShader(gl, gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
          v_uv = a_position * 0.5 + 0.5;
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `);
      const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D u_source;
        varying vec2 v_uv;
        const float PI = 3.14159265358979323846;
        const float HALF_FOV = 1.7453292519943295;

        vec2 lensUv(vec3 direction, float facing, float centerX) {
          float lensZ = direction.z * facing;
          float theta = acos(clamp(lensZ, -1.0, 1.0));
          float radial = theta / HALF_FOV;
          float divisor = max(sin(theta), 0.00001);
          float localX = direction.x * facing / divisor;
          float localY = direction.y / divisor;
          return vec2(centerX + 0.25 * radial * localX, 0.5 - 0.5 * radial * localY);
        }

        void main() {
          vec2 pano = vec2(v_uv.x, 1.0 - v_uv.y);
          float longitude = (pano.x - 0.5) * 2.0 * PI;
          float latitude = (0.5 - pano.y) * PI;
          float latitudeCos = cos(latitude);
          vec3 direction = vec3(latitudeCos * sin(longitude), sin(latitude), latitudeCos * cos(longitude));
          vec4 front = texture2D(u_source, lensUv(direction, 1.0, 0.75));
          vec4 back = texture2D(u_source, lensUv(direction, -1.0, 0.25));
          float seamBlend = smoothstep(-0.035, 0.035, direction.z);
          gl_FragColor = mix(back, front, seamBlend);
        }
      `);
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`360° 변환기를 연결할 수 없습니다. (${gl.getProgramInfoLog(program) || 'unknown program error'})`);
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bitmap);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('INSP 사진을 그래픽 메모리에 올리지 못했습니다. 다른 탭을 닫고 다시 시도해 주세요.');
      gl.uniform1i(gl.getUniformLocation(program, 'u_source'), 0);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.finish();
      if (gl.getError() !== gl.NO_ERROR) throw new Error('INSP 360° 변환 도중 그래픽 오류가 발생했습니다.');
      return canvas;
    } finally {
      bitmap.close();
    }
  }

  let preparedCache = null;
  async function prepareImages(source, progress) {
    const insp = /\.insp$/i.test(source.name);
    const header = new Uint8Array(await source.slice(0, 1024 * 1024).arrayBuffer());
    const mime = imageMime(header);
    if (!mime) throw new Error('사진을 읽을 수 없습니다. X6 INSP 또는 360° JPG·PNG·WebP를 선택해 주세요.');
    const dimensions = dimensionsFor(header, mime);
    const canvases = new Set();
    let panoramaCanvas = null;
    let bitmap = null;
    try {
      if (insp) {
        if (mime !== 'image/jpeg') throw new Error('이 INSP 파일의 사진 데이터를 읽을 수 없습니다. 카메라 원본 파일인지 확인해 주세요.');
        if (!dimensions || dimensions.width < 2048 || dimensions.height < 1024 || dimensions.width / dimensions.height < 1.92 || dimensions.width / dimensions.height > 2.08) {
          throw new Error('X6 듀얼 렌즈 INSP 사진 형식이 아닙니다. 원본 파일을 다시 선택해 주세요.');
        }
        panoramaCanvas = await stitchDualFisheye(source, dimensions, progress);
        canvases.add(panoramaCanvas);
      } else {
        progress('사진 크기 최적화 중…');
        try {
          if (dimensions) {
            const ratio = dimensions.width / dimensions.height;
            if (dimensions.width < 1024 || dimensions.height < 512 || ratio < 1.92 || ratio > 2.08) throw new Error('ratio');
            const width = Math.min(8192, dimensions.width);
            bitmap = await resizedBitmap(source, mime, width, Math.round(width / ratio));
          } else bitmap = await createImageBitmap(source.slice(0, source.size, mime));
        } catch { throw new Error('1024×512 이상인 2:1 비율의 360° 파노라마가 필요합니다.'); }
        const ratio = bitmap.width / bitmap.height;
        if (bitmap.width < 1024 || bitmap.height < 512 || ratio < 1.92 || ratio > 2.08) {
          throw new Error('1024×512 이상인 2:1 비율의 360° 파노라마가 필요합니다.');
        }
        panoramaCanvas = scaledCanvas(bitmap, 8192);
        canvases.add(panoramaCanvas);
      }

      // Encode the existing full-size canvas directly; do not copy another
      // 8K buffer. Derive the thumbnail from 4K, then run independent encoders.
      const medium = panoramaCanvas.width > 4096 ? scaledCanvas(panoramaCanvas, 4096) : panoramaCanvas;
      canvases.add(medium);
      const small = scaledCanvas(medium, 640);
      canvases.add(small);
      progress('웹용 사진과 미리보기 준비 중…');
      const sameDisplay = medium === panoramaCanvas;
      const pending = [canvasBlob(panoramaCanvas, .90), ...(sameDisplay ? [] : [canvasBlob(medium, .86)]), canvasBlob(small, .80)];
      const results = await Promise.allSettled(pending);
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      const blobs = results.map(result => result.value);
      return sameDisplay ? { image4k: blobs[0], thumb: blobs[1], image8kRef: 'image4k' }
        : { image8k: blobs[0], image4k: blobs[1], thumb: blobs[2] };
    } finally {
      bitmap?.close();
      if (insp && panoramaCanvas) panoramaCanvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
      for (const canvas of canvases) canvas.width = canvas.height = 1;
    }
  }

  window.preparePanoramaUpload = async function (data, progress = () => {}) {
    const source = data.get('panorama');
    if (!(source instanceof File) || !source.size) throw new Error('사진을 선택해 주세요.');
    if (source.size > MAX_SOURCE_BYTES) throw new Error('원본 파일은 최대 48MB까지 업로드할 수 있습니다.');
    if (!preparedCache || preparedCache.source !== source) {
      const entry = { source, promise: prepareImages(source, progress) };
      preparedCache = entry;
      entry.promise.catch(() => { if (preparedCache === entry) preparedCache = null; });
    } else progress('준비된 사진을 재사용합니다…');
    const images = await preparedCache.promise;
    data.delete('sourceOnly');
    for (const key of ['image8k', 'image4k', 'thumb', 'image8kRef']) data.delete(key);
    for (const key of ['image8k', 'image4k', 'thumb']) if (images[key]) data.set(key, images[key], key + '.jpg');
    if (images.image8kRef) data.set('image8kRef', images.image8kRef);
    const size = [...data.values()].reduce((total, value) => total + (value instanceof Blob ? value.size : String(value).length), 0);
    if (size > MAX_BODY_BYTES) throw new Error('원본과 웹용 사진의 합계가 62MB를 초과합니다. 원본 용량을 줄여 주세요.');
    progress(`전송 준비 완료 · ${(size / 1024 / 1024).toFixed(1)} MB`);
    return data;
  };

  window.sendPanoramaUpload = (data, { csrf, progress = () => {} } = {}) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/admin/scenes', true);
    request.withCredentials = true;
    if (csrf) request.setRequestHeader('X-CSRF-Token', csrf);
    request.upload.onprogress = event => progress({ phase: 'uploading', loaded: event.loaded, total: event.lengthComputable ? event.total : null });
    request.upload.onload = () => progress({ phase: 'saving' });
    request.onload = () => {
      let payload;
      try { payload = JSON.parse(request.responseText); }
      catch { reject(new Error('서버 응답을 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')); return; }
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else reject(new Error(payload.error || (request.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : `사진 업로드에 실패했습니다. (${request.status})`)));
    };
    request.onerror = () => reject(new Error('사진 전송이 중단되었습니다. 연결을 확인하고 다시 시도해 주세요. 준비된 사진은 재사용됩니다.'));
    request.onabort = () => reject(new Error('사진 전송이 취소되었습니다.'));
    request.ontimeout = () => reject(new Error('사진 전송 시간이 초과되었습니다. 다시 시도해 주세요.'));
    request.send(data);
  });
})();
