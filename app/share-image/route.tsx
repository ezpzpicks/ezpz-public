import { ImageResponse } from "next/og";
const size = { width: 1200, height: 630 };
export function GET() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0c1015", color: "#eef0f3", padding: "76px", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
      <svg width="138" height="66" viewBox="0 0 92 44"><path fill="#168fff" d="M16 2h34l-5 10H25l-3 6h17l-5 9H18l-3 6h22l-5 10H0zM55 2h37l-5 10-30 21h22l-5 10H37l5-10 30-21H50z" /></svg>
      <div style={{ borderLeft: "2px solid #59616c", paddingLeft: 28, fontSize: 52, fontWeight: 700 }}>EZPZ PICKS</div>
    </div>
    <div style={{ display: "flex", marginTop: 68, fontSize: 60, fontWeight: 700, letterSpacing: -2 }}>The full slate. A clearer view.</div>
    <div style={{ display: "flex", marginTop: 20, fontSize: 27, color: "#b6beca" }}>Model projections · Official picks · Transparent records</div>
    <div style={{ display: "flex", marginTop: "auto", borderTop: "1px solid #343b43", paddingTop: 28, justifyContent: "space-between", fontSize: 24 }}>
      <span style={{ color: "#57afff" }}>NBA · NCAAM · NFL · NCAAF · MLB</span><span>ezpzpicks.com</span>
    </div>
  </div>, size);
}
