import type { Island } from "./types";

// Phase instructions for the island learn flow — one Hungarian prompt per
// sub-step, sent as the system prompt with every /api/chat call.
export function getPhaseInstruction(
  phase: string,
  isFollowUp: boolean,
  currentIsland?: Island,
  islandStep?: "teach" | "assess" | "remediation",
  assessRound?: number,
  assessQuestionRef?: string,
  provenConcepts?: string[],
  feedbackHint?: string,
  teachConceptIndex?: number,
  teachIntent?: "example" | "simpler" | null,
): string {
  if (currentIsland) {
    const concepts = currentIsland.key_concepts;
    const focusConcept = concepts[Math.min(Math.max(0, teachConceptIndex ?? 0), Math.max(0, concepts.length - 1))] ?? "";
    if (islandStep === "teach" && teachIntent === "example" && focusConcept) {
      return `Fázis: Tanítás, plusz példa — csak 1 újabb rövid példa ugyanarra a fogalomra ("${focusConcept}", a(z) "${currentIsland.title}" részből), 2-3 mondatban. Más fogalmat, listát, bevezetőt, köszönést tilos. Vágás tilos: mindig fejezd be az utolsó mondatot. Beszélj magyarul.`;
    }

    if (islandStep === "teach" && teachIntent === "simpler" && focusConcept) {
      return `Fázis: Tanítás, egyszerűbben — ugyanaz a fogalom ("${focusConcept}", a(z) "${currentIsland.title}" részből) még egyszerűbben, 3-4 mondatban, 1 hétköznapi példával. Más fogalmat, listát, bevezetőt, köszönést tilos. Vágás tilos: mindig fejezd be az utolsó mondatot. Beszélj magyarul.`;
    }

    if (islandStep === "teach" && !isFollowUp) {
      const approachOpeners: Record<string, string> = {
        scenario: "Nyiss egy valós életből vett szituációval, majd azon keresztül magyarázd ezt az EGY fogalmat.",
        socratic: "Először magyarázd el egyszerűen ezt az EGY fogalmat, majd a már elmagyarázottakra építő EGY irányított kérdéssel mélyítsd — soha ne kérdezz olyat, amit még nem magyaráztál el.",
        conversational: "Magyarázd el természetes, beszélgetős stílusban ezt az EGY fogalmat.",
      };
      const opener = approachOpeners[currentIsland.approach] ?? approachOpeners.conversational;
      const conceptLabel = focusConcept || "a következő fogalmat";
      return `Fázis: Tanítás (falatnyi) — feltételezd, hogy a felhasználó semmit nem tud. Köszönés és bevezető tilos — az első mondat a tananyag legyen. Tanítsd PONTOSAN EGY fogalmat: "${conceptLabel}" (a(z) "${currentIsland.title}" részből). MAX 4 mondat, MAX ~500 karakter. Pontosan 1 rövid tananyagi példa vagy hétköznapi analógia. Több fogalmat, listát, más szigetet vagy későbbi témát tilos említeni. ${opener} Vágás tilos: mindig fejezd be az utolsó mondatot — ha nem fér ki, rövidítsd a példát, soha ne hagyd félbe a mondatot. Beszélj magyarul.`;
    }

    if (islandStep === "teach" && isFollowUp) {
      return `Fázis: Tanítás, folytatás — tanárként válaszolj a felhasználó kérdésére vagy reagálj a visszajelzésére. Feltételezd, hogy a felhasználó kezdő. Válasz MAX 4 mondatban, pontosan 1 rövid példával. Ha értetlenséget jelez, magyarázd ELTÉRŐ megközelítéssel. Ne osztályozz, ne válts diák-szerepbe, ne kérdezz olyat, amit még nem magyaráztál el. Köszönés és bevezető tilos. Vágás tilos: mindig fejezd be az utolsó mondatot. Beszélj magyarul.`;
    }

    if (islandStep === "assess" && !isFollowUp) {
      const focus = assessQuestionRef || currentIsland.key_concepts[0] || "";
      // Prefer a probe question about the focus concept; a mismatched hint
      // would steer Lumi at the wrong concept.
      const focusWords = focus.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const probe =
        currentIsland.probe_questions.find((q) => {
          const lower = q.toLowerCase();
          return focusWords.some((w) => lower.includes(w));
        }) ?? null;
      const probeHint = probe ? ` Kiindulásnak használhatod ezt a kérdést: "${probe}".` : "";
      return `Fázis: Ellenőrzés — fordított tanár. Te most egy lelkes, de értetlen diák vagy, a felhasználó a tanárod. A(z) "${currentIsland.title}" témából a következő fogalmat NEM érted: "${focus}". Kezdd könnyű visszamondó kérdéssel ("Mondd el saját szavaiddal, hogy te hogy magyaráznád el..."), ne trükkös megértéstesztelővel. Tegyél fel EGYETLEN természetes, diákos kérdést erről a fogalomról — olyat, amire csak valódi megértéssel lehet jól válaszolni, bemagolt definícióval nem. Ne magyarázz, ne segíts, csak kérdezz. Beszélj magyarul.${probeHint}`;
    }

    if ((islandStep === "assess" || islandStep === "remediation") && isFollowUp) {
      const hint = feedbackHint || "A felhasználó válaszolt a kérdésedre.";
      return `Fázis: Ellenőrzés — fordított tanár, reakció. A tanárod (a felhasználó) most magyarázott neked. Értékelési támpont: ${hint}. Diákként reagálj erre 2-3 mondatban: ha jól magyarázott, mutasd meg, hogy megértetted (mondd vissza SAJÁT példával); ha hibázott vagy hiányos volt, diákos értetlenséggel kérdezz vissza pont a problémás részre. Ne oktasd ki, ne javítsd ki tanárosan — te a diák vagy. Beszélj magyarul.`;
    }

    if (islandStep === "remediation" && !isFollowUp) {
      const weakList = provenConcepts?.length
        ? currentIsland.key_concepts.filter((k) => !provenConcepts.includes(k)).join(", ")
        : currentIsland.key_concepts.join(", ");
      return `Fázis: Felzárkóztatás. A felhasználónak a következő fogalmak mentek gyengén: ${weakList}. Most rövid időre lépj ki a diák-szerepből: tanulópartnerként adj fogalmanként egy rövid (3-4 mondatos), az eddigitől ELTÉRŐ megközelítésű magyarázatot — hétköznapi analógiával vagy konkrét példával. Zárásként jelezd, hogy mindjárt visszaváltasz diáknak, és újra kérdezni fogsz. Beszélj magyarul.`;
    }
  }
  if (phase === "explain") {
    return isFollowUp
      ? "A felhasználó reagált a magyarázatodra. Válaszolj a kérdésére vagy nyugtázd röviden, majd folytasd a téma következő részével. Beszélj magyarul."
      : "Fázis: Gyakorlatok — Magyarázd el a témát lépésről lépésre a tananyag alapján. Részletes és érthető magyarázatot adj.";
  }
  return "";
}
