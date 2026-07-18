export function selectProviderModel(input: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  onSelectProvider?: (providerId: string) => void;
  onSelectModel?: (modelId: string) => void;
}): void {
  if (input.onSelectProviderAndModel) {
    input.onSelectProviderAndModel(input.nextProviderId, input.modelId);
    return;
  }
  if (input.nextProviderId !== input.currentProvider) {
    input.onSelectProvider?.(input.nextProviderId);
  }
  input.onSelectModel?.(input.modelId);
}
