"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * Shows a toast carried across a redirect in the URL (`?param=message`), then
 * drops the parameter so a reload or a shared link does not repeat it. The
 * toast id makes a double-invoked effect (React strict mode) show it once.
 */
export default function FlashToast({ param, message }: { param: string; message: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    toast.success(message, { id: `flash:${param}:${message}` });
    const next = new URLSearchParams(params.toString());
    next.delete(param);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [message, param, params, pathname, router]);

  return null;
}
