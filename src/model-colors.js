// SPDX-License-Identifier: MPL-2.0

const PROVIDER_PATTERNS = [
  ["openai", /(?:^|[ /])(gpt-|o1-|o3-|o4-)/],
  ["anthropic", /(?:^|[ /])claude-/],
  ["google", /(?:^|[ /])gemini-/],
  ["xai", /(?:^|[ /])grok-/],
  ["meta", /(?:^|[ /])muse-/],
  ["zhipu", /(?:^|[ /])glm-/],
  ["moonshot", /(?:^|[ /])kimi-/],
  ["deepseek", /(?:^|[ /])deepseek-/],
  ["mistral", /(?:^|[ /])mistral-/],
  ["xiaomi", /(?:^|[ /])mimo-/],
  ["minimax", /(?:^|[ /])minimax/],
  ["alibaba", /(?:^|[ /])qwen/],
  ["cursor", /(?:^|[ /])composer-/],
];

export function modelProvider(model) {
  const normalized = model.toLowerCase().replaceAll("_", "-");
  return PROVIDER_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0]
    ?? "other";
}

function providerColor(provider) {
  return `var(--family-${provider})`;
}

export function modelFamilyColor(model) {
  return providerColor(modelProvider(model));
}

function shadeColor(provider, index) {
  const baseColor = providerColor(provider);
  if (index === 0) return baseColor;
  const step = provider === "openai" ? 8 : 11;
  return `hsl(from ${baseColor} h s clamp(25, calc(l + (${
    step * index
  } * var(--mark-l-dir))), 82))`;
}

export function createModelColorMap(configurations) {
  const models = new Map();
  for (const configuration of configurations) {
    const existing = models.get(configuration.model);
    models.set(configuration.model, {
      bestPassAt1: Math.max(
        existing?.bestPassAt1 ?? 0,
        configuration.passAt1,
      ),
      model: configuration.model,
      provider: modelProvider(configuration.model),
    });
  }

  const providerModels = new Map();
  for (const model of models.values()) {
    const groupedModels = providerModels.get(model.provider) ?? [];
    groupedModels.push(model);
    providerModels.set(model.provider, groupedModels);
  }

  const colors = new Map();
  for (const [provider, groupedModels] of providerModels) {
    groupedModels
      .sort((left, right) => (
        right.bestPassAt1 - left.bestPassAt1
        || left.model.localeCompare(right.model)
      ))
      .forEach((model, index) => {
        colors.set(model.model, shadeColor(provider, index));
      });
  }
  return colors;
}
