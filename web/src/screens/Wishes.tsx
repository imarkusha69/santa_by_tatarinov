import { useEffect } from "react";
import { useApp } from "../lib/app";
import { GiftBox, Ornament } from "../components/Decor";
import { IconPlus } from "../components/Icons";
import { Btn, Empty, ErrorBox, Item, Stagger, Title } from "../components/ui";
import { WishCard, WishGridSkeleton, sortByPriority } from "../components/WishCard";

export function WishesScreen() {
  const { myWishes, myWishesError, reloadMyWishes, push, lastAddedWish } = useApp();
  useEffect(() => {
    void reloadMyWishes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen with-sticky">
      <Ornament tone="red" size={64} thread={50} style={{ top: -6, right: 10 }} />
      <Stagger>
        <Title main="Мои" script="желания" />
        {myWishesError && !myWishes && <ErrorBox message={myWishesError.message} onRetry={reloadMyWishes} />}
        {!myWishes ? (
          <WishGridSkeleton />
        ) : myWishes.length === 0 ? (
          <Empty
            art={<GiftBox size={120} style={{ position: "relative" }} />}
            title="Список пока пуст"
            text="Добавьте то, что хотели бы получить: ссылку, фото, размер и цвет. Ваш Тайный Санта увидит список после жеребьёвки."
          />
        ) : (
          <Item>
            <p className="muted small" style={{ marginTop: -8 }}>
              Список можно менять в любой момент, Санта получит уведомление.
            </p>
            <div className="wish-grid">
              {sortByPriority(myWishes).map((w) => (
                <WishCard key={w.id} wish={w} isNew={w.id === lastAddedWish} onOpen={() => push({ name: "wish", wish: w, owner: true })} />
              ))}
            </div>
          </Item>
        )}
      </Stagger>
      <div className="sticky-cta">
        <Btn onClick={() => push({ name: "wishForm" })}>
          <IconPlus size={22} /> Добавить желание
        </Btn>
      </div>
    </div>
  );
}
