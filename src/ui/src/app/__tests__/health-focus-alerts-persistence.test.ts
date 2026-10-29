/**
 * health-focus-alerts-persistence.test.ts
 *
 * Regression tests for:
 * 1. Popup toggle deprecation and active health mode badge display.
 * 2. Options tab health focus selection, immediate state update, and multi-layer persistence.
 * 3. Onboarding persistence without overriding subsequent options changes.
 * 4. Dashboard theme synchronization across storage layers.
 * 5. Flyout disease warning evaluation (e.g. sugar > 22.5g for diabetes) and rendering without premium gating.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd().replace(/[/\\]src[/\\]ui$/, "");
const popupSrc       = readFileSync(join(ROOT, "src/ui/src/app/components/Popup.tsx"), "utf8");
const optionsSrc     = readFileSync(join(ROOT, "src/ui/src/options/Options.tsx"), "utf8");
const onboardingSrc  = readFileSync(join(ROOT, "src/ui/src/app/lib/persistOnboarding.ts"), "utf8");
const dashboardSrc   = readFileSync(join(ROOT, "src/ui/src/app/components/Dashboard.tsx"), "utf8");
const sharedUiSrc    = readFileSync(join(ROOT, "src/extension/adapters/shared-ui.js"), "utf8");
const backgroundSrc  = readFileSync(join(ROOT, "src/extension/background.js"), "utf8");
const contentSrc     = readFileSync(join(ROOT, "src/extension/content.js"), "utf8");

describe("1. Popup Health Mode Toggle Deprecation", () => {
  it("Popup.tsx does not contain the old manual toggle switch button or handleToggleHealthMode", () => {
    expect(popupSrc).not.toContain("handleToggleHealthMode");
    expect(popupSrc).not.toContain("<button onClick={handleToggleHealthMode}");
    expect(popupSrc).not.toContain("role=\"switch\"");
  });

  it("Popup.tsx renders an active health mode indicator badge", () => {
    expect(popupSrc).toContain("Health Mode");
    expect(popupSrc).toContain("General Wellness");
    expect(popupSrc).toContain("HEALTH_MODES[activeFocusTag");
    expect(popupSrc).toContain("tagColor.bg");
    expect(popupSrc).toContain("tagColor.label");
  });
});

describe("2. Options Tab Health Focus Selection & Persistence", () => {
  it("Options.tsx updates component state immediately on focus card click", () => {
    const cardClickIdx = optionsSrc.indexOf("setData(newData as any);");
    expect(cardClickIdx).toBeGreaterThan(-1);
    const cardClickBlock = optionsSrc.slice(cardClickIdx - 300, cardClickIdx + 300);

    // setData(newData as any) ensures React re-renders and highlights the card instantly
    expect(cardClickBlock).toContain("setData(newData as any);");
    expect(cardClickBlock).toContain("MultiLayerStorage.updateDraft");
  });

  it("Options.tsx handleSave persists condition to MultiLayerStorage, chrome.storage, and IndexedDB", () => {
    const saveIdx = optionsSrc.indexOf("const handleSave = async () => {");
    expect(saveIdx).toBeGreaterThan(-1);
    const saveBlock = optionsSrc.slice(saveIdx, saveIdx + 3000);

    expect(saveBlock).toContain("MultiLayerStorage.commitDraftToLive()");
    expect(saveBlock).toContain("chrome.storage.local.set");
    expect(saveBlock).toContain("uiTheme: theme");
    expect(saveBlock).toContain("saveSettings");
    expect(saveBlock).toContain("activeTheme: theme");
    expect(saveBlock).toContain("diabetes: condition === \"diabetes\"");
    expect(saveBlock).toContain("hypertension: condition === \"hypertension\"");
  });

  it("Options.tsx loadData reconciles effective condition across storage layers", () => {
    const loadIdx = optionsSrc.indexOf("const effectiveCondition =");
    expect(loadIdx).toBeGreaterThan(-1);
    const loadBlock = optionsSrc.slice(loadIdx, loadIdx + 500);

    expect(loadBlock).toContain("local?.user_account");
    expect(loadBlock).toContain("storageData?.user_account");
    expect(loadBlock).toContain("idbSettings?.activeTheme");
  });
});

describe("3. Onboarding & Dashboard Theme Sync", () => {
  it("persistOnboarding preserves existing condition/theme settings and does not write condition flags", () => {
    expect(onboardingSrc).toContain("saveSettings");
    expect(onboardingSrc).not.toContain("activeTheme: finalTheme");
    expect(onboardingSrc).not.toContain("uiTheme: finalTheme");
    expect(onboardingSrc).toContain("MultiLayerStorage.commitDraftToLive()");
  });

  it("Dashboard.tsx selectCondition syncs activeTheme to IndexedDB and chrome.storage", () => {
    const selectIdx = dashboardSrc.indexOf("function selectCondition(");
    expect(selectIdx).toBeGreaterThan(-1);
    const selectBlock = dashboardSrc.slice(selectIdx, selectIdx + 1200);

    expect(selectBlock).toContain("saveSettings");
    expect(selectBlock).toContain("activeTheme: condition");
    expect(selectBlock).toContain("chrome.storage.local.set");
    expect(selectBlock).toContain("uiTheme: condition");
  });
});

describe("4. Flyout Disease Warning Alert Rendering & Evaluation", () => {
  it("shared-ui.js evaluates diabetes thresholds (sugar > 22.5g, carbs > 60g) dynamically", () => {
    expect(sharedUiSrc).toContain('activeTheme === "diabetes"');
    expect(sharedUiSrc).toContain("prof.sugars_g > 22.5");
    expect(sharedUiSrc).toContain("prof.carbs_g > 60.0");
    expect(sharedUiSrc).toContain("High sugar (>22.5g per 100g)");
  });

  it("shared-ui.js evaluates hypertension, kidney, and obesity thresholds dynamically", () => {
    expect(sharedUiSrc).toContain('activeTheme === "hypertension"');
    expect(sharedUiSrc).toContain("prof.sodium_mg > 600.0");
    expect(sharedUiSrc).toContain('activeTheme === "kidney"');
    expect(sharedUiSrc).toContain("prof.potassium_mg > 200.0");
    expect(sharedUiSrc).toContain('activeTheme === "obesity"');
  });

  it("shared-ui.js renders disease warnings whenever activeTheme !== 'general' without isPremium check", () => {
    const renderWarnIdx = sharedUiSrc.indexOf('if (activeTheme !== "general" && tc && warningsList.length > 0)');
    expect(renderWarnIdx).toBeGreaterThan(-1);
    const renderWarnBlock = sharedUiSrc.slice(renderWarnIdx, renderWarnIdx + 1200);

    expect(renderWarnBlock).not.toContain("productResult.isPremium");
    expect(renderWarnBlock).not.toContain("hazardSVG");
    expect(renderWarnBlock).toContain("this.escapeHTML(chipPrefix)");
    expect(renderWarnBlock).toContain("Informational only, not medical advice.");
  });

  it("shared-ui.js produces zero disease alert HTML when activeTheme is 'general'", () => {
    const generalCheckIdx = sharedUiSrc.indexOf('if (activeTheme !== "general" && tc && warningsList.length > 0)');
    expect(generalCheckIdx).toBeGreaterThan(-1);
    const renderWarnBlock = sharedUiSrc.slice(generalCheckIdx, generalCheckIdx + 700);

    expect(renderWarnBlock).toContain('diseaseHTML = "";');
  });

  it("background.js appendPremiumAssessment evaluates nutritional benchmarks for non-general themes", () => {
    const assessIdx = backgroundSrc.indexOf("async function appendPremiumAssessment(");
    expect(assessIdx).toBeGreaterThan(-1);
    const assessEnd = backgroundSrc.indexOf("chrome.runtime.onMessage.addListener", assessIdx);
    const assessBlock = backgroundSrc.slice(assessIdx, assessEnd);

    expect(assessBlock).toContain('result.activeTheme !== "general"');
    expect(assessBlock).toContain("sugar > 22.5");
    expect(assessBlock).toContain("sodium > 600.0");
    expect(assessBlock).toContain("result.diseaseWarnings = warnings;");
  });

  it("content.js triggers rescan on uiTheme, settings_live, or user_preferences changes", () => {
    const listenerIdx = contentSrc.indexOf("chrome.storage.onChanged.addListener");
    expect(listenerIdx).toBeGreaterThan(-1);
    const listenerBlock = contentSrc.slice(listenerIdx, listenerIdx + 600);

    expect(listenerBlock).toContain("changes.uiTheme");
    expect(listenerBlock).toContain("this.rescan()");
  });
});
