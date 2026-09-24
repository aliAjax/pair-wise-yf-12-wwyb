// ============================================================
// 存档层：油站数据的读写与本地持久化
// Pinia + localStorage，纯前端存储，不接后台。
// 旧版本记录（字段名不同、缺坐标）在读取时统一迁移、留档。
// ============================================================

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  ALL_REGIONS,
  REGIONS,
  dispatchStats,
  filterByRegion,
  regionCodes,
  type Coord,
  type Draft,
  type Region,
  type Station,
} from "./stationRules";

const STORAGE_KEY = "hxwlfront-21-station-map";
const DAY = 24 * 60 * 60 * 1000;

/** 首次启动的种子数据：含告急站、停业站、缺坐标的旧档案，便于核对各条规则 */
function seedStations(): Station[] {
  const now = Date.now();
  return [
    { id: "seed-1", name: "东区一站", region: "东区", stock: 36000, manager: "刘站长", coord: { x: 70, y: 66 }, closed: false, createdAt: new Date(now - 6 * DAY).toISOString() },
    // 旧记录缺坐标：先留档，编辑保存前需补位置
    { id: "seed-2", name: "东区老站", region: "东区", stock: 15000, manager: "赵站长", coord: null, closed: false, createdAt: new Date(now - 5 * DAY).toISOString() },
    // 库存不足 8000 升：告急
    { id: "seed-3", name: "西区油库站", region: "西区", stock: 6200, manager: "陈站长", coord: { x: 24, y: 42 }, closed: false, createdAt: new Date(now - 4 * DAY).toISOString() },
    { id: "seed-4", name: "西区二站", region: "西区", stock: 18500, manager: "周站长", coord: { x: 33, y: 56 }, closed: false, createdAt: new Date(now - 3 * DAY).toISOString() },
    { id: "seed-5", name: "机场快线站", region: "机场线", stock: 9000, manager: "王站长", coord: { x: 56, y: 24 }, closed: false, createdAt: new Date(now - 2 * DAY).toISOString() },
    // 停业站：点位保留可查，退出调度统计
    { id: "seed-6", name: "机场北站", region: "机场线", stock: 21000, manager: "孙站长", coord: { x: 64, y: 31 }, closed: true, createdAt: new Date(now - 1 * DAY).toISOString() },
  ];
}

/** 读取并迁移历史记录：旧字段名映射、缺坐标的一律留档为 null */
function normalize(raw: unknown[]): Station[] {
  return raw.map((item, index) => {
    const record = (item ?? {}) as Record<string, unknown> & { coord?: Coord | null };
    const region = String(record.region ?? record.area ?? "");
    const coord = record.coord;
    return {
      id: String(record.id ?? `legacy-${index + 1}`),
      name: String(record.name ?? record.station ?? "未命名油站"),
      region: (REGIONS as readonly string[]).includes(region) ? (region as Region) : REGIONS[0],
      stock: Math.max(0, Number(record.stock) || 0),
      manager: String(record.manager ?? "未登记"),
      coord:
        coord && Number.isFinite(coord.x) && Number.isFinite(coord.y)
          ? { x: Number(coord.x), y: Number(coord.y) }
          : null,
      closed: Boolean(record.closed ?? record.status === "暂停营业"),
      createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    };
  });
}

function load(): Station[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedStations();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalize(parsed) : seedStations();
  } catch {
    return seedStations();
  }
}

export const useStationStore = defineStore("stations", () => {
  // —— 状态 ——
  const stations = ref<Station[]>(load());
  const regionFilter = ref<string>(ALL_REGIONS);
  const selectedId = ref<string | null>(null);

  // —— 派生（判定规则全部来自判定层） ——
  const visibleStations = computed(() => filterByRegion(stations.value, regionFilter.value));
  const codes = computed(() => regionCodes(stations.value));
  const stats = computed(() => dispatchStats(visibleStations.value));

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stations.value));
  }

  // —— 写操作 ——
  function addStation(draft: Draft): Station {
    const station: Station = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      region: draft.region as Region,
      stock: Math.max(0, Number(draft.stock) || 0),
      manager: draft.manager.trim(),
      coord: draft.coord ? { ...draft.coord } : null,
      closed: false,
      createdAt: new Date().toISOString(),
    };
    stations.value = [station, ...stations.value];
    persist();
    return station;
  }

  function updateStation(id: string, draft: Draft) {
    stations.value = stations.value.map((s) =>
      s.id === id
        ? {
            ...s,
            name: draft.name.trim(),
            region: draft.region as Region,
            stock: Math.max(0, Number(draft.stock) || 0),
            manager: draft.manager.trim(),
            coord: draft.coord ? { ...draft.coord } : null,
          }
        : s,
    );
    persist();
  }

  /** 停业 / 恢复营业：停业后点位保留在地图上，仅退出调度统计 */
  function setClosed(id: string, closed: boolean) {
    stations.value = stations.value.map((s) => (s.id === id ? { ...s, closed } : s));
    persist();
  }

  function setRegionFilter(region: string) {
    regionFilter.value = region;
  }

  function select(id: string | null) {
    selectedId.value = id;
  }

  return {
    stations,
    regionFilter,
    selectedId,
    visibleStations,
    codes,
    stats,
    addStation,
    updateStation,
    setClosed,
    setRegionFilter,
    select,
  };
});
