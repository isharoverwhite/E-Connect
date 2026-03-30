import { BridgeCompleteClient } from "./BridgeCompleteClient";

type BridgeCompletePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BridgeCompletePage({ searchParams }: BridgeCompletePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const rawBridgePayload = resolvedSearchParams.bridge;
  const encodedBridgePayload = Array.isArray(rawBridgePayload) ? rawBridgePayload[0] : rawBridgePayload;

  return <BridgeCompleteClient encodedBridgePayload={encodedBridgePayload} />;
}
