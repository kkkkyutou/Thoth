export interface ProviderControlDisplayModelOption {
  id: string;
  label: string;
}

export function resolveProviderControlDisplayLabel({
  modelOptions,
  selectedModelId,
  provider,
  providerLabel,
}: {
  modelOptions?: ProviderControlDisplayModelOption[];
  selectedModelId?: string;
  provider: string;
  providerLabel?: string;
}): string {
  const modelId = selectedModelId?.trim();
  if (modelId) {
    return modelOptions?.find((option) => option.id === modelId)?.label ?? modelId;
  }
  const fallbackModel = modelOptions?.[0];
  if (fallbackModel) {
    return fallbackModel.label || fallbackModel.id;
  }
  const fallbackProviderLabel = providerLabel?.trim();
  const fallbackProvider = provider.trim();
  if (fallbackProviderLabel && fallbackProviderLabel !== "Provider") {
    return fallbackProviderLabel;
  }
  return fallbackProvider || fallbackProviderLabel || "Provider";
}
