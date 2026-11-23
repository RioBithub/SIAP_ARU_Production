"use client";

import dynamic from "next/dynamic";
import type { SessionUser } from "@/lib/types";

function LoadingCorrespondence() {
  return <main className="page"><p role="status">Memuat persuratan…</p></main>;
}

// Let the route's error boundary load before requesting the interactive screen.
const Letters = dynamic(() => import("@/components/LettersClient"), {
  ssr: false,
  loading: LoadingCorrespondence,
});
const Dispositions = dynamic(() => import("@/components/DispositionsClient"), {
  ssr: false,
  loading: LoadingCorrespondence,
});

export default function CorrespondenceScreen({ view, user }: {
  view: "INCOMING" | "INTERNAL" | "OUTGOING" | "DISPOSITIONS";
  user: SessionUser;
}) {
  return view === "DISPOSITIONS" ? <Dispositions user={user}/> : <Letters direction={view} user={user}/>;
}
