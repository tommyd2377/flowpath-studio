import Image from 'next/image';

/** One loading rhythm, scaled to the area that is actually waiting. */
export default function BrandLoader({ variant = 'component', label }: {
  variant?: 'screen' | 'component' | 'inline'; label?: string;
}) {
  const screen = variant === 'screen';
  return <span className={`brand-loader brand-loader--${variant}`} role={label ? 'status' : undefined}
    aria-live={label ? 'polite' : undefined} aria-hidden={label ? undefined : true}>
    <Image className="brand-loader__image" src={screen ? '/brand/flowpath-logo-full.png' : '/brand/flowpath-icon-square.png'}
      alt="" aria-hidden="true" width={screen ? 1536 : 512} height={screen ? 1024 : 512}
      sizes={screen ? '(max-width: 600px) 240px, 280px' : variant === 'inline' ? '20px' : '56px'} loading="eager" />
    {label && <span className="brand-loader__label">{label}</span>}
  </span>;
}
