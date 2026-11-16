"use strict";

(() => {
  class ArrowPositionEditor {
    constructor({ canEdit, getLinks, savePosition, onChange }) {
      Object.assign(this, { canEdit, getLinks, savePosition, onChange });
      this.phase = "off";
      this.sourceId = null;
      this.selected = null;
      this.preview = null;
      this.message = "";
      this.operation = 0;
    }
    get active() { return this.phase !== "off"; }
    get saving() { return this.phase === "saving"; }
    open(sourceId) {
      if (!this.canEdit() || this.saving) return false;
      this.sourceId = sourceId;
      this.phase = "select";
      this.selected = null;
      this.preview = null;
      this.message = "옮길 화살표를 누르거나 목록에서 선택하세요.";
      this.onChange();
      return true;
    }
    select(id) {
      if (!this.active || this.saving || !this.canEdit()) return false;
      const link = this.getLinks(this.sourceId).find(link => String(link.id) === String(id));
      if (id && !link) return false;
      this.selected = link ? { ...link } : null;
      this.preview = null;
      this.phase = link ? "place" : "select";
      this.message = link ? "사진에서 새 위치를 클릭하세요. 즉시 저장됩니다." : "옮길 화살표를 누르거나 목록에서 선택하세요.";
      this.onChange();
      return true;
    }
    close(force = false) {
      if (this.saving && !force) return false;
      this.operation += 1;
      this.phase = "off";
      this.selected = null;
      this.preview = null;
      this.onChange();
      return true;
    }
    async place({ yaw, pitch }) {
      if (this.phase !== "place" || !this.selected || !this.canEdit()) return false;
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || pitch < -90 || pitch > 90) return false;
      const link = this.getLinks(this.sourceId).find(link => link.id === this.selected.id);
      if (!link || link.toScene !== this.selected.toScene) {
        this.select(null);
        return false;
      }
      const operation = ++this.operation;
      this.preview = { yaw, pitch };
      this.phase = "saving";
      this.message = "화살표 위치를 저장하고 있습니다…";
      this.onChange();
      try {
        // No source/target, label or reverse edge is ever submitted here.
        await this.savePosition(link.id, { yaw, pitch });
        if (operation !== this.operation) return true;
        this.phase = "select";
        this.selected = null;
        this.preview = null;
        this.message = "저장했습니다. 다음 화살표를 선택하세요.";
        this.onChange();
        return true;
      } catch (error) {
        if (operation !== this.operation) return false;
        this.phase = "place";
        this.preview = null;
        this.message = `${error.message} 저장하지 못했습니다. 새 위치를 다시 클릭하세요.`;
        this.onChange();
        return false;
      }
    }
  }
  window.ArrowPositionEditor = ArrowPositionEditor;
})();
