"use client";

// Route map for a plan. Loaded with next/dynamic({ ssr: false }) because Leaflet
// touches `window`. Tiles: standard OpenStreetMap tiles (no key; fine for
// low-volume use with attribution per the OSM tile policy), slightly
// desaturated via CSS to match the UI. Pins are numbered to match the timeline.

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

export interface MapPoint {
  lat: number;
  lon: number;
  label: string; // "S", "1", "2"...
  name: string;
  kind: "start" | "activity" | "food";
  time?: string;
}

const COLORS: Record<MapPoint["kind"], string> = {
  start: "#1c1917", // stone-900
  activity: "#f97316", // orange-500
  food: "#f43f5e", // rose-500
};

function pin(p: MapPoint) {
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${COLORS[p.kind]};color:#fff;font:600 12px/28px ui-sans-serif,system-ui;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${p.label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])), { padding: [36, 36], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export default function RouteMap({ points }: { points: MapPoint[] }) {
  if (points.length === 0) return null;
  const line = points.map((p) => [p.lat, p.lon] as [number, number]);
  return (
    <MapContainer
      center={line[0]}
      zoom={13}
      scrollWheelZoom={false}
      className="h-64 w-full sm:h-72"
      attributionControl
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
        className="saturate-[.55] contrast-[.95]"
      />
      <Polyline positions={line} pathOptions={{ color: "#f97316", weight: 3, opacity: 0.8, dashArray: "6 8" }} />
      {points.map((p) => (
        <Marker key={`${p.label}-${p.lat}-${p.lon}`} position={[p.lat, p.lon]} icon={pin(p)}>
          <Tooltip direction="top" offset={[0, -14]}>
            <span className="text-xs font-medium">
              {p.time ? `${p.time} · ` : ""}
              {p.name}
            </span>
          </Tooltip>
        </Marker>
      ))}
      <FitBounds points={points} />
    </MapContainer>
  );
}
