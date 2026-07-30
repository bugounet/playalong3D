import { describe, expect, it } from "vitest";
import { catalogs, LANGUAGES, translate } from "./i18n";

describe("interface translations", () => {
  it("provides every source key in all four languages", () => {
    const sourceKeys = Object.keys(catalogs.en);

    expect(LANGUAGES.map(({ code }) => code)).toEqual(["fr", "en", "de", "es"]);
    for (const { code } of LANGUAGES) {
      expect(Object.keys(catalogs[code]).sort()).toEqual(sourceKeys.sort());
      expect(Object.values(catalogs[code]).every(Boolean)).toBe(true);
    }
  });

  it("interpolates variables in translated messages", () => {
    expect(translate("de", "notice.loopNext", { score: 97, tempo: 75 })).toBe(
      "Genauigkeit 97/100 · weiter mit 75 % Tempo.",
    );
    expect(translate("es", "top.keys", { count: 88 })).toBe("88 teclas");
  });
});
