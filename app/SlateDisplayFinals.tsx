"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SlateDisplayFinal } from "../lib/slateDisplayFinals";
const Finals = createContext<SlateDisplayFinal[]>([]);
export const useSlateDisplayFinals = () => useContext(Finals);
export default function SlateDisplayFinals({sport,date,children}:{sport:string;date:string;children:ReactNode}) {
  const [saved,setSaved] = useState<{date:string;finals:SlateDisplayFinal[]}|null>(null);
  useEffect(()=>{
    if (sport !== "NFL") return;
    const controller = new AbortController();
    void fetch(`/api/slate-display-finals?sport=NFL&date=${encodeURIComponent(date)}`,{signal:controller.signal})
      .then(async response=>{const data=await response.json();if(response.ok && data.ok && data.sport === sport && data.date === date && Array.isArray(data.finals) && !controller.signal.aborted)setSaved({date,finals:data.finals});})
      .catch(()=>{}); // A missing independent final never becomes a guessed score.
    return ()=>controller.abort();
  },[sport,date]);
  return <Finals.Provider value={sport === "NFL" && saved?.date === date ? saved.finals : []}>{children}</Finals.Provider>;
}
