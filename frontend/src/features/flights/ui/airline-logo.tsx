'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * An airline's logo, or its code in a tile when there is no logo or the image cannot be loaded
 * (an old or external URL), so a card never shows a broken image.
 */
export function AirlineLogo({
  src,
  code,
  name,
  size = 40,
  className,
}: {
  src: string | null;
  code: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = cn(
    'flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted',
    className,
  );
  if (!src || failed)
    return (
      <span
        className={cn(box, 'font-semibold text-muted-foreground')}
        style={{ width: size, height: size, fontSize: size / 3 }}
        aria-hidden="true"
      >
        {code}
      </span>
    );
  return (
    <span className={box} style={{ width: size, height: size }}>
      <Image
        src={src}
        alt={`${name} logo`}
        width={size}
        height={size}
        unoptimized
        onError={() => setFailed(true)}
        className="size-full object-contain"
      />
    </span>
  );
}
