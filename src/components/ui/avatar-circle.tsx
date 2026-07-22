import { useEffect, useState } from 'react';
import { signAvatar, initialsFromName } from '@/lib/avatar';

interface Props {
  name: string | null | undefined;
  /** Signed URL (already resolved). Prefer this when the list has already signed. */
  url?: string | null;
  /** Raw storage path — resolved to a signed URL client-side. */
  path?: string | null;
  size?: number;
  className?: string;
}

export function AvatarCircle({ name, url, path, size = 32, className = '' }: Props) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(url ?? null);

  useEffect(() => {
    if (url !== undefined) {
      setResolvedUrl(url);
      return;
    }
    let cancelled = false;
    if (!path) {
      setResolvedUrl(null);
      return;
    }
    signAvatar(path).then((u) => {
      if (!cancelled) setResolvedUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [url, path]);

  const dim = { width: size, height: size };
  const fontSize = Math.round(size * 0.38);

  if (resolvedUrl) {
    return (
      <img
        src={resolvedUrl}
        alt={name ?? ''}
        style={dim}
        className={`rounded-full object-cover bg-[hsl(var(--trophi-ink))] ${className}`}
      />
    );
  }
  return (
    <div
      style={dim}
      className={`rounded-full bg-[hsl(var(--trophi-ink))] text-[hsl(var(--trophi-gold))] font-display font-semibold flex items-center justify-center flex-shrink-0 ${className}`}
    >
      <span style={{ fontSize }}>{initialsFromName(name)}</span>
    </div>
  );
}
