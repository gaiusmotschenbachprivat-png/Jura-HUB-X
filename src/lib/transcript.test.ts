import { describe, expect, it } from "vitest";

import { formatTime, parseTime, parseTranscript, transcriptPages, transcriptText } from "./transcript";

describe("Transkript einer Aufnahme", () => {
  it("Zeiten formatieren und lesen", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(parseTime("1:02:05")).toBe(3725);
    expect(parseTime("12:30")).toBe(750);
    expect(parseTime("x")).toBeNull();
  });

  it("Seiten je fünf Minuten, Zeitmarken je Zeile, zurück lesbar", () => {
    const segs = [
      { t: 5, text: "Heute geht es um den Totschlag." },
      { t: 70, text: "  § 212   StGB  " },
      { t: 610, text: "Nun zur Körperverletzung." },
      { t: 620, text: "" },
    ];
    const pages = transcriptPages(segs);
    expect(pages).toEqual(["[0:05] Heute geht es um den Totschlag.\n[1:10] § 212 StGB", "[10:10] Nun zur Körperverletzung."]);
    expect(parseTranscript(pages)).toEqual([
      { t: 5, text: "Heute geht es um den Totschlag." },
      { t: 70, text: "§ 212 StGB" },
      { t: 610, text: "Nun zur Körperverletzung." },
    ]);
    expect(transcriptText(parseTranscript(pages))).toBe("[0:05] Heute geht es um den Totschlag. § 212 StGB \n[10:10] Nun zur Körperverletzung.");
  });
});
