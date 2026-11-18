import { motion } from "motion/react";
import { useRef, useState } from "react";
import { PRIORITY_LABEL, type Photo, type Wish } from "../lib/types";
import { formatPrice } from "./ui";
import { haptic } from "../lib/telegram";
import { galleryOf } from "../lib/cover";
import { CoverPlaceholder } from "./CoverPlaceholder";

/** Фото со свайпом (нативный scroll-snap) и точками-индикаторами. */
export function PhotoCarousel({
  photos,
  size,
  onTap,
  pending,
}: {
  photos: Photo[];
  size: "small" | "large";
  onTap?: (index: number) => void;
  pending?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  if (!photos.length) return <CoverPlaceholder pending={pending} large={size === "large"} />;
  return (
    <>
      <div
        className="carousel"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== idx) setIdx(i);
        }}
      >
        {photos.map((p, i) => (
          <div key={p.base} onClick={onTap ? () => onTap(i) : undefined}>
            <img
              src={size === "small" ? p.small : p.large}
              alt=""
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              draggable={false}
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="dots">
          {photos.map((p, i) => (
            <i key={p.base} className={i === idx ? "on" : ""} />
          ))}
        </div>
      )}
    </>
  );
}

export function WishCard({ wish, onOpen, isNew, pending }: { wish: Wish; onOpen: () => void; isNew?: boolean; pending?: boolean }) {
  const price = formatPrice(wish.price);
  const photos = galleryOf(wish);
  return (
    <motion.div
      layout="position"
      initial={isNew ? { scale: 0.4, opacity: 0, y: 80 } : { opacity: 0, y: 24 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={isNew ? { type: "spring", duration: 0.35, bounce: 0.3 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: "50% 100%" }}
    >
      <div
        className="wish-card"
        role="button"
        tabIndex={0}
        onClick={() => {
          haptic.tap();
          onOpen();
        }}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
      >
        <div className="wish-photo">
          <PhotoCarousel photos={photos} size="small" pending={pending && !photos.length} />
          <span className={`prio prio-${wish.priority}`}>{PRIORITY_LABEL[wish.priority]}</span>
          {photos.length > 1 && <span className="photo-count">{photos.length} фото</span>}
        </div>
        <div className="wish-meta">
          {price && <div className="price">{price}</div>}
          <div className="wish-title">{wish.title}</div>
          {wish.shop && <div className="wish-shop">{wish.shop}</div>}
        </div>
      </div>
    </motion.div>
  );
}

export function WishGridSkeleton() {
  return (
    <div className="wish-grid">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="wish-card">
          <div className="skel" style={{ aspectRatio: "3 / 4", borderRadius: 12 }} />
          <div className="wish-meta">
            <div className="skel" style={{ height: 18, width: "50%", marginBottom: 8 }} />
            <div className="skel" style={{ height: 14, marginBottom: 6 }} />
            <div className="skel" style={{ height: 14, width: "70%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function sortByPriority(wishes: Wish[]) {
  return [...wishes].sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt));
}
