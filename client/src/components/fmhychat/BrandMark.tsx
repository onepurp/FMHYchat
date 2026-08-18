/** FMHY Reference Tool: preserve the supplied FMHYchat mark as a compact utility identifier. */

type BrandMarkProps = {
  size?: "small" | "large";
  showWordmark?: boolean;
};

export function BrandMark({ size = "small", showWordmark = true }: BrandMarkProps) {
  const markSize = size === "large" ? "h-14 w-14" : "h-8 w-8";

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <img alt="FMHYchat" className={`${markSize} shrink-0 object-contain`} decoding="async" src="/fmhychat-play-mark.png" />
      {showWordmark ? (
        <span className="min-w-0 font-semibold tracking-[-0.055em] text-[#3c3c43] dark:text-[#dfdfd6]">
          FMHY<span className="text-[#5d99da]">chat</span>
        </span>
      ) : null}
    </div>
  );
}
