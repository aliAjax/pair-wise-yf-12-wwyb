<script setup lang="ts">
// 页面层 - 地图组件：Leaflet 本地经纬度网格，不加载任何在线瓦片。
// 新增/编辑时点击地图点选坐标；停业站点仍显示灰点，点击点位可选中列表。
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  hasCoordinate,
  isClosed,
  isUrgent,
  type Station,
} from "../business/rules";

const props = withDefaults(
  defineProps<{
    stations: Station[];
    numbers: Map<string, number>;
    picked: { lng: number; lat: number } | undefined;
    editingId: string | null;
    selectedId?: string | null;
    pickMode?: boolean;
  }>(),
  { selectedId: null, pickMode: true },
);

const emit = defineEmits<{
  (e: "pick", point: { lng: number; lat: number }): void;
  (e: "select", id: string): void;
}>();

const mapEl = ref<HTMLElement | null>(null);
const cursor = ref("");

let map: L.Map | null = null;
const markerLayer = L.layerGroup();
let pickedMarker: L.Layer | null = null;

const DEFAULT_CENTER: L.LatLngExpression = [39.95, 116.45];
const DEFAULT_ZOOM = 11;

// 纯本地经纬网瓦片：替代在线底图，保证不请求任何外部服务。
const Graticule = L.GridLayer.extend({
  createTile(coords: L.Coords): HTMLElement {
    const tile = document.createElement("canvas");
    tile.width = 256;
    tile.height = 256;
    const ctx = tile.getContext("2d");
    /* v8 ignore next */
    if (!ctx) return tile;

    const owner = this as unknown as { _map: L.Map };
    const tileMap = owner._map;
    const z = coords.z;
    const origin = L.point(coords.x * 256, coords.y * 256);
    const corner = L.point((coords.x + 1) * 256, (coords.y + 1) * 256);
    const nw = tileMap.unproject(origin, z);
    const se = tileMap.unproject(corner, z);

    ctx.fillStyle = "#edf2f8";
    ctx.fillRect(0, 0, 256, 256);

    const span = Math.max(Math.abs(se.lng - nw.lng), 1e-9);
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
    const step = steps.find((value) => span / value <= 5) ?? 10;
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;

    const px = (lat: number, lng: number) => {
      const point = tileMap.project(L.latLng(lat, lng), z).subtract(origin);
      return [point.x, point.y] as const;
    };

    ctx.lineWidth = 1;
    ctx.font = "10px sans-serif";

    const minLng = Math.min(nw.lng, se.lng);
    const maxLng = Math.max(nw.lng, se.lng);
    const minLat = Math.min(nw.lat, se.lat);
    const maxLat = Math.max(nw.lat, se.lat);

    for (let i = Math.ceil(minLng / step); i * step < maxLng; i += 1) {
      const lng = i * step;
      const [x] = px(minLat, lng);
      ctx.strokeStyle = "#c2d1e2";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
      ctx.fillStyle = "#7e93ab";
      ctx.fillText(`${lng.toFixed(decimals)}°E`, x + 3, 250);
    }

    for (let i = Math.ceil(minLat / step); i * step < maxLat; i += 1) {
      const lat = i * step;
      const [, y] = px(lat, minLng);
      ctx.strokeStyle = "#c2d1e2";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
      ctx.fillStyle = "#7e93ab";
      ctx.fillText(`${lat.toFixed(decimals)}°N`, 4, y - 3);
    }

    return tile;
  },
});

function pinClass(station: Station): string {
  if (isClosed(station)) return "station-pin pin-closed";
  if (isUrgent(station.stock)) return "station-pin pin-urgent";
  return "station-pin pin-normal";
}

function drawMarkers() {
  if (!map) return;
  markerLayer.clearLayers();
  for (const station of props.stations) {
    if (!hasCoordinate(station) || station.id === props.editingId) continue;
    const number = props.numbers.get(station.id);
    const icon = L.divIcon({
      className: "",
      html: `<div class="${pinClass(station)}${station.id === props.selectedId ? " pin-active" : ""}"><span>${number ?? "·"}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    const marker = L.marker([station.lat, station.lng], { icon, keyboard: false });
    const stateText = isClosed(station) ? "已停业" : isUrgent(station.stock) ? "库存告急" : "库存正常";
    marker.bindTooltip(
      `${station.area} #${number ?? "-"} ${station.name}｜库存 ${station.stock.toLocaleString()} L｜${stateText}｜${station.manager}`,
      { direction: "top", offset: [0, -13] },
    );
    marker.on("click", () => emit("select", station.id));
    markerLayer.addLayer(marker);
  }
}

function drawPicked() {
  if (!map) return;
  if (pickedMarker) {
    pickedMarker.remove();
    pickedMarker = null;
  }
  if (!props.picked) return;
  const icon = L.divIcon({
    className: "",
    html: '<div class="picked-pin"><div class="picked-core"></div></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  pickedMarker = L.marker([props.picked.lat, props.picked.lng], {
    icon,
    keyboard: false,
    interactive: false,
  }).addTo(map);
}

function fitView() {
  if (!map) return;
  const points = props.stations.filter(hasCoordinate).map((s) => L.latLng(s.lat, s.lng));
  if (points.length === 1) {
    map.setView(points[0], Math.max(map.getZoom(), 12));
  } else if (points.length > 1) {
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 13 });
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value, {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    minZoom: 9,
    maxZoom: 18,
    attributionControl: false,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (Graticule as any)({ tileSize: 256 }).addTo(map);
  markerLayer.addTo(map);

  map.on("click", (event: L.LeafletMouseEvent) => {
    if (!props.pickMode) return;
    emit("pick", {
      lng: Number(event.latlng.lng.toFixed(6)),
      lat: Number(event.latlng.lat.toFixed(6)),
    });
  });
  map.on("mousemove", (event: L.LeafletMouseEvent) => {
    cursor.value = `经度 ${event.latlng.lng.toFixed(5)}　纬度 ${event.latlng.lat.toFixed(5)}`;
  });

  drawMarkers();
  drawPicked();
  fitView();
  requestAnimationFrame(() => map?.invalidateSize());
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});

watch(
  () => [props.stations, props.numbers, props.selectedId, props.editingId],
  () => {
    drawMarkers();
    drawPicked();
  },
);
watch(() => props.picked, drawPicked, { deep: true });
watch(() => props.stations, fitView);
</script>

<template>
  <div class="map-wrap">
    <div ref="mapEl" class="map-canvas" />
    <p class="map-hint">
      {{ pickMode ? "点击地图为当前表单点选坐标" : "地图只读" }}
      ｜红点=库存告急，灰点=停业（可查看但不计调度）
    </p>
    <p class="map-cursor">{{ cursor || "在地图上移动鼠标查看经纬度" }}</p>
  </div>
</template>
