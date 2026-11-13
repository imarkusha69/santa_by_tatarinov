export type Priority = 1 | 2 | 3;

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: "Очень хочу",
  2: "Хочу",
  3: "Было бы приятно",
};

export interface Profile {
  name: string;
  bio: string;
  avatar: string | null;
  avatarSource: "custom" | "telegram" | "none";
  tgAvatar: string | null;
}

export interface GameListItem {
  id: string;
  name: string;
  status: "open" | "drawn";
  code: string;
  isOrganizer: boolean;
}

export interface InvitePreview {
  gameId: string;
  code: string;
  name: string;
  status: "open" | "drawn";
  isMember: boolean;
  families: { id: string; name: string; position: 0 | 1; count: number }[];
}

export interface MeResponse {
  user: Profile;
  games: GameListItem[];
  invite: InvitePreview | null;
}

export interface Family {
  id: string;
  name: string;
  position: 0 | 1;
}

export interface MemberPublic {
  memberId: string;
  familyId: string;
  name: string;
  avatar: string | null;
  isMe: boolean;
  isOrganizer: boolean;
  wishCount?: number;
}

export interface RecipientBrief {
  memberId: string;
  name: string;
  avatar: string | null;
  bio: string;
  familyName: string;
}

export interface GameState {
  id: string;
  name: string;
  status: "open" | "drawn";
  code: string;
  isOrganizer: boolean;
  inviteLink: string | null;
  families: Family[];
  members: MemberPublic[];
  me: { memberId: string; familyId: string; envelopeOpened: boolean };
  recipient: RecipientBrief | null;
}

export interface Photo {
  base: string;
  small: string;
  large: string;
}

export interface WishDetails {
  color?: string;
  size?: string;
  model?: string;
}

export type CoverSource = "auto" | "manual" | "none";
export type CoverReason =
  | "invalid_url"
  | "blocked_host"
  | "robots_disallowed"
  | "timeout"
  | "not_html"
  | "no_image"
  | "too_large"
  | "download_failed";

export interface WishCover {
  source: CoverSource;
  /** Подписанная ссылка на показываемую обложку (наша копия в Storage). */
  url: string | null;
  /** Подписанная ссылка на фото со страницы товара (только у владельца). */
  autoUrl: string | null;
  error: CoverReason | null;
  updatedAt: string | null;
}

export interface Wish {
  id: string;
  title: string;
  url: string | null;
  price: number | null;
  shop: string | null;
  priority: Priority;
  details: WishDetails;
  comment: string | null;
  updatedAt: string;
  cover: WishCover;
  /** Дополнительные фото после обложки. */
  photos: Photo[];
}

export interface Recipient extends RecipientBrief {
  wishes: Wish[];
}

export interface ChatMessage {
  id: string;
  text: string;
  createdAt: string;
  mine: boolean;
  pending?: boolean;
}

export interface ChatData {
  available: boolean;
  title: string;
  messages: ChatMessage[];
}

export interface OrgPerson {
  memberId: string;
  name: string;
  avatar: string | null;
  familyName: string;
  familyPosition: 0 | 1;
}

export interface OrgPair {
  assignmentId: string;
  santa: OrgPerson;
  receiver: OrgPerson;
  count: number;
  fromSanta: number;
  last: { text: string; createdAt: string; direction: "santa_to_receiver" | "receiver_to_santa" } | null;
}

export interface OrgChat {
  santaName: string;
  receiverName: string;
  messages: {
    id: string;
    text: string;
    createdAt: string;
    direction: "santa_to_receiver" | "receiver_to_santa";
    delivered: boolean;
  }[];
}
