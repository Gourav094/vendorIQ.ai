import { useQuery } from "@tanstack/react-query";

const BASE_CURRENCY = "INR";

interface ExchangeRatesData {
  rates: Record<string, number>;
  timestamp: string | null;
}

const fetchExchangeRates = async (): Promise<ExchangeRatesData> => {
  const response = await fetch(`https://open.er-api.com/v6/latest/${BASE_CURRENCY}`);

  if (!response.ok) {
    throw new Error(`Exchange rate request failed with status ${response.status}`);
  }

  const payload = await response.json();

  if (payload.result !== "success" || !payload.rates) {
    const reason = payload["error-type"] || "Unable to retrieve exchange rates right now.";
    throw new Error(reason);
  }

  const normalizedRates = Object.entries(payload.rates as Record<string, unknown>).reduce<Record<string, number>>(
    (acc, [code, value]) => {
      if (typeof value === "number") {
        acc[code.toUpperCase()] = value;
      }
      return acc;
    },
    {}
  );
  normalizedRates[BASE_CURRENCY] = normalizedRates[BASE_CURRENCY] ?? 1;

  const timestamp =
    typeof payload.time_last_update_unix === "number"
      ? new Date(payload.time_last_update_unix * 1000).toLocaleString()
      : typeof payload.time_last_update_utc === "string"
        ? payload.time_last_update_utc
        : null;

  return { rates: normalizedRates, timestamp };
};

export const useExchangeRates = (enabled: boolean = true) => {
  return useQuery({
    queryKey: ["exchangeRates", BASE_CURRENCY],
    queryFn: fetchExchangeRates,
    staleTime: 60 * 60 * 1000, // Fresh for 1 hour (rates don't change frequently)
    gcTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
    retry: 2,
    enabled,
    refetchOnWindowFocus: false,
  });
};

export { BASE_CURRENCY };
