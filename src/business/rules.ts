// 业务判定层：编号、告急、统计口径、坐标校验等纯逻辑，不依赖存储与页面。

export const LOW_STOCK_THRESHOLD = 8000; // 库存不足 8000 升判定为告急

export type AreaName = "东区" | "西区" | "机场线";

export const AREAS: readonly AreaName[] = ["东区", "西区", "机场线"];

export interface Station {
  id: string;
  name: string;
  area: AreaName;
  stock: number; // 单位：升
  manager: string;
  status: "营业中" | "停业";
  notes?: string;
  lng?: number; // 经度
  lat?: number; // 纬度
  /** 旧记录缺坐标时留档，补位置保存后自动解除 */
  archived?: boolean;
  createdAt: string;
}

export interface StationDraft {
  name: string;
  area: AreaName;
  stock: number;
  manager: string;
  notes?: string;
  lng?: number;
  lat?: number;
}

export interface StationStats {
  /** 参与调度的油站数（停业与留档不计） */
  dispatchCount: number;
  /** 库存告急油站数（库存 < 8000 升，停业、留档不计） */
  urgentCount: number;
  /** 调度库存合计（停业、留档不计） */
  totalStock: number;
}

/** 库存不足八千升标成告急 */
export function isUrgent(stock: number): boolean {
  return stock < LOW_STOCK_THRESHOLD;
}

/** 停业站点：点位仍可查看，但退出调度统计 */
export function isClosed(station: Pick<Station, "status">): boolean {
  return station.status === "停业";
}

export function hasCoordinate(
  station: Pick<Station, "lng" | "lat">,
): station is Station & { lng: number; lat: number } {
  return (
    typeof station.lng === "number" &&
    typeof station.lat === "number" &&
    Number.isFinite(station.lng) &&
    Number.isFinite(station.lat)
  );
}

/** 参与调度统计：在营且有坐标（留档、停业均退出） */
export function inDispatch(
  station: Station,
): station is Station & { lng: number; lat: number } {
  return !station.archived && !isClosed(station) && hasCoordinate(station);
}

/**
 * 同一区域的点位按库存从低到高编号。
 * 仅对有坐标、未留档的点位编号；同库存按名称稳定排序。
 * 返回 id -> 区域内序号 的映射。
 */
export function buildAreaNumbers(stations: readonly Station[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const area of AREAS) {
    const points = stations
      .filter((s) => s.area === area && !s.archived && hasCoordinate(s))
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, "zh-Hans-CN"));
    points.forEach((station, index) => numbers.set(station.id, index + 1));
  }
  return numbers;
}

/** 顶部调度统计，只统计传入的这批油站（区域切换由调用方过滤） */
export function summarize(stations: readonly Station[]): StationStats {
  const active = stations.filter(inDispatch);
  return {
    dispatchCount: active.length,
    urgentCount: active.filter((s) => isUrgent(s.stock)).length,
    totalStock: active.reduce((sum, s) => sum + s.stock, 0),
  };
}

/** 编辑保存前必须补齐位置（名称/区域/库存/负责人也要完整） */
export function validateDraft(
  draft: StationDraft,
): string | null {
  if (!draft.name.trim()) return "请填写油站名称";
  if (!AREAS.includes(draft.area)) return "请选择所属区域";
  if (!Number.isFinite(draft.stock) || draft.stock < 0) return "库存需为不小于 0 的数字（升）";
  if (!draft.manager.trim()) return "请填写负责人";
  if (!hasCoordinate(draft)) return "请先在地图上点选坐标，再保存";
  return null;
}
