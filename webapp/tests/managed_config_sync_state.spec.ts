import { expect, test } from "@playwright/test";

import {
  doesManagedConfigMatch,
  resolveManagedConfigEditorBaseline,
  type ManagedConfigComparable,
} from "../src/features/diy/managed-config-sync";

const committedConfig: ManagedConfigComparable = {
  pins: [
    {
      gpio_pin: 3,
      mode: "OUTPUT",
      function: "fan",
      label: "Quat",
      extra_params: { active_level: 1, subtype: "on_off" },
    },
  ],
  wifiCredentialId: 7,
  assignedDeviceName: "Den + Quat",
};

const historicalConfig: ManagedConfigComparable = {
  pins: [
    {
      gpio_pin: 3,
      mode: "PWM",
      function: "fan",
      label: "Quat",
      extra_params: { min_value: 0, max_value: 255, subtype: "pwm" },
    },
  ],
  wifiCredentialId: 7,
  assignedDeviceName: "Den + Quat",
};

test.describe("managed config sync state", () => {
  test("re-entry uses the committed config as the dirty baseline for the current config id", () => {
    const staleHistorySnapshot: ManagedConfigComparable = {
      pins: historicalConfig.pins,
      wifiCredentialId: historicalConfig.wifiCredentialId,
      assignedDeviceName: historicalConfig.assignedDeviceName,
    };

    const baseline = resolveManagedConfigEditorBaseline({
      loadedConfigId: "cfg-current",
      currentConfigId: "cfg-current",
      pendingConfigId: null,
      committed: committedConfig,
      pending: null,
      loaded: staleHistorySnapshot,
      fallback: committedConfig,
    });

    expect(doesManagedConfigMatch(committedConfig, baseline)).toBe(true);
    expect(doesManagedConfigMatch(staleHistorySnapshot, baseline)).toBe(false);
  });

  test("loading an older history snapshot does not make it equivalent to the committed firmware config", () => {
    const baseline = resolveManagedConfigEditorBaseline({
      loadedConfigId: "cfg-old",
      currentConfigId: "cfg-current",
      pendingConfigId: null,
      committed: committedConfig,
      pending: null,
      loaded: historicalConfig,
      fallback: committedConfig,
    });

    expect(doesManagedConfigMatch(historicalConfig, baseline)).toBe(true);
    expect(doesManagedConfigMatch(historicalConfig, committedConfig)).toBe(false);
  });
});
