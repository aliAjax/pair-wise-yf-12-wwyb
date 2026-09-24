// ============================================================
// 判定层：油站业务规则
// 纯函数与常量，不依赖 Vue / Pinia / 浏览器接口，可独立测试。
// ============================================================

/** 告急线：库存不足 8000 升即判定告急 */
export const CRITICAL_STOCK_LITERS = 8000;

/** 本地网格地图边长（公里）。坐标完全在本站生成，不依赖外部地图服务 */
export const GRID_SIZE_KM = 100;

export const REGIONS = ["东区", "西区", "机场线"] as const;
export type Region = (typeof REGIONS)[number];

/** 区域筛选里的“全部”选项 */
export const ALL_REGIONS = "全部区域";

export interface Coord {
  /** 东西向公里（0~100，向东增大） */
  x: number;
  /** 南北向公里（0~100，向北增大） */
  y: number;
}

export interface Station {
  id: string;
  name: string;
  region: Region;
  /** 当前库存（升） */
  stock: number;
  manager: string;
  /** 地图坐标；旧记录可能缺失，缺坐标时只留档、不落图 */
  coord: Coord | null;
  /** 停业后点位保留可查，但退出调度统计 */
  closed: boolean;
  createdAt: string;
}

/** 新增 / 编辑共用的表单草稿 */
export interface Draft {
  name: string;
  region: Region | "";
  stock: number;
  manager: string;
  coord: Coord | null;
}

export type StationStatus = "营业中" | "告急" | "已停业" | "待补坐标";

export function isCritical(stock: number): boolean {
  return stock < CRITICAL_STOCK_LITERS;
}

export function stationStatus(station: Station): StationStatus {
  if (station.closed) return "已停业";
  if (!station.coord) return "待补坐标";
  if (isCritical(station.stock)) return "告急";
  return "营业中";
}

function compareByStock(a: Station, b: Station): number {
  return a.stock - b.stock || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * 同一区域内的点位按库存从低到高编号（东区-01、东区-02 ……）。
 * 只有已落图（有坐标）的点位参与编号；缺坐标的留档记录不占号。
 */
export function regionCodes(stations: Station[]): Map<string, string> {
  const codes = new Map<string, string>();
  for (const region of REGIONS) {
    stations
      .filter((s) => s.region === region && s.coord !== null)
      .sort(compareByStock)
      .forEach((s, index) => {
        codes.set(s.id, `${region}-${String(index + 1).padStart(2, "0")}`);
      });
  }
  return codes;
}

export function codeOf(station: Station, codes: Map<string, string>): string {
  return codes.get(station.id) ?? "待补坐标";
}

/** 列表排序：先按区域，再按库存从低到高（与编号顺序一致） */
export function compareByRegionStock(a: Station, b: Station): number {
  return REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || compareByStock(a, b);
}

/** 区域筛选：列表、地图、顶部统计共用同一批油站 */
export function filterByRegion(stations: Station[], regionFilter: string): Station[] {
  if (regionFilter === ALL_REGIONS) return [...stations];
  return stations.filter((s) => s.region === regionFilter);
}

export interface DispatchStats {
  /** 在营（参与调度）的油站数 */
  active: number;
  /** 其中告急（库存不足 8000 升）的油站数 */
  critical: number;
  /** 在营油站库存合计（升） */
  totalStock: number;
}

/** 调度统计：停业油站退出统计，但点位仍保留在地图上 */
export function dispatchStats(stations: Station[]): DispatchStats {
  const active = stations.filter((s) => !s.closed);
  return {
    active: active.length,
    critical: active.filter((s) => isCritical(s.stock)).length,
    totalStock: active.reduce((sum, s) => sum + s.stock, 0),
  };
}

/** 保存前校验：新增与编辑共用；缺坐标的旧记录必须先在地图上补位置 */
export function validateDraft(draft: Draft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("请填写油站名称");
  if (!draft.region) errors.push("请选择所属区域");
  if (!Number.isFinite(draft.stock) || draft.stock < 0) errors.push("请填写有效的库存（不小于 0 升）");
  if (!draft.manager.trim()) errors.push("请填写负责人");
  if (!draft.coord) errors.push("请先在地图上点选油站坐标");
  return errors;
}

export function formatCoord(coord: Coord | null): string {
  if (!coord) return "缺坐标（留档）";
  return `X ${coord.x.toFixed(1)} km / Y ${coord.y.toFixed(1)} km`;
}
