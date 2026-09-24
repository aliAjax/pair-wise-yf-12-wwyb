// 存档层：油站记录的持久化与变更（localStorage），不关心页面怎么画。
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  AREAS,
  hasCoordinate,
  type AreaName,
  type Station,
  type StationDraft,
} from "../business/rules";

const STORAGE_KEY = "hxwlfront-21-station-map";

/** 种子数据：含 1 条没有坐标的旧记录，载入时按旧档留档处理 */
function seedStations(): Station[] {
  const now = Date.now();
  const day = 86_400_000;
  const seed: Array<Omit<Station, "id" | "createdAt" | "archived">> = [
    { name: "东区一站", area: "东区", stock: 36000, manager: "刘站长", status: "营业中", notes: "库存正常", lng: 116.462, lat: 39.928 },
    { name: "东区二环站", area: "东区", stock: 7200, manager: "赵站长", status: "营业中", notes: "柴油待补", lng: 116.49, lat: 39.905 },
    { name: "西区三环站", area: "西区", stock: 12800, manager: "钱站长", status: "营业中", notes: "早晚高峰繁忙", lng: 116.286, lat: 39.914 },
    { name: "西区首钢站", area: "西区", stock: 24500, manager: "孙站长", status: "停业", notes: "站区改造暂停营业", lng: 116.205, lat: 39.89 },
    { name: "机场快线站", area: "机场线", stock: 9000, manager: "王站长", status: "营业中", notes: "机场方向车流大", lng: 116.597, lat: 39.972 },
    { name: "机场T2站", area: "机场线", stock: 31000, manager: "周站长", status: "营业中", notes: "24 小时营业", lng: 116.622, lat: 40.05 },
    // 旧记录：手工录入，缺坐标，先留档
    { name: "北区临时站", area: "东区", stock: 6400, manager: "吴站长", status: "营业中", notes: "纸质台账迁入，位置待补" },
  ];
  return seed.map((s, index) => ({
    ...s,
    id: `seed-${index + 1}`,
    createdAt: new Date(now - index * day).toISOString(),
    archived: !hasCoordinate(s),
  }));
}

function loadStations(): Station[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedStations();
  try {
    const parsed = JSON.parse(raw) as Station[];
    // 缺坐标的旧记录一律先留档，位置补齐保存后解除
    return parsed.map((station) => ({
      ...station,
      archived: station.archived || !hasCoordinate(station),
    }));
  } catch {
    return seedStations();
  }
}

function emptyDraft(): StationDraft {
  return { name: "", area: AREAS[0], stock: 0, manager: "", notes: "", lng: undefined, lat: undefined };
}

export const useStationStore = defineStore("station-archive", () => {
  const stations = ref<Station[]>(loadStations());
  const draft = ref<StationDraft>(emptyDraft());
  const editingId = ref<string | null>(null);

  const archivedStations = computed(() => stations.value.filter((s) => s.archived));

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stations.value));
  }

  /** 新增油站：先在地图点选坐标，再保存名称、区域、库存和负责人 */
  function addStation(data: StationDraft): Station {
    const station: Station = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      area: data.area,
      stock: data.stock,
      manager: data.manager.trim(),
      notes: data.notes?.trim() || "暂无备注",
      status: "营业中",
      lng: data.lng,
      lat: data.lat,
      archived: false,
      createdAt: new Date().toISOString(),
    };
    stations.value.unshift(station);
    persist();
    return station;
  }

  /** 编辑保存：旧记录补位置后一并解除留档 */
  function updateStation(id: string, data: StationDraft) {
    const index = stations.value.findIndex((s) => s.id === id);
    if (index === -1) return;
    const previous = stations.value[index];
    stations.value[index] = {
      ...previous,
      name: data.name.trim(),
      area: data.area,
      stock: data.stock,
      manager: data.manager.trim(),
      notes: data.notes?.trim() || previous.notes || "暂无备注",
      lng: data.lng,
      lat: data.lat,
      archived: false, // 位置已补齐
    };
    persist();
  }

  /** 某站停业（或恢复营业）；停业点位仍可查看，仅退出调度统计 */
  function toggleClosed(id: string) {
    const station = stations.value.find((s) => s.id === id);
    if (!station) return;
    station.status = station.status === "停业" ? "营业中" : "停业";
    persist();
  }

  function startCreate() {
    editingId.value = null;
    draft.value = emptyDraft();
  }

  function startEdit(station: Station) {
    editingId.value = station.id;
    draft.value = {
      name: station.name,
      area: station.area,
      stock: station.stock,
      manager: station.manager,
      notes: station.notes ?? "",
      lng: station.lng,
      lat: station.lat,
    };
  }

  function cancelEdit() {
    editingId.value = null;
    draft.value = emptyDraft();
  }

  /** 表单地图点选坐标 */
  function setCoordinate(lng: number, lat: number) {
    draft.value = { ...draft.value, lng, lat };
  }

  return {
    stations,
    draft,
    editingId,
    archivedStations,
    addStation,
    updateStation,
    toggleClosed,
    startCreate,
    startEdit,
    cancelEdit,
    setCoordinate,
  };
});

export type { AreaName };
