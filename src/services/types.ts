export type BookFormat = "pdf" | "epub";
export type BookStatus = "unread" | "reading" | "finished";
export interface Book {
  id: string;
  title: string;
  author: string;
  cover_url: string | null;
  format: BookFormat;
  created_at: string;
}
// Returned only to an authorized owner by the storage backend, never a public query.
export interface BookFile {
  book_id: string;
  file_hash: string;
  file_size: number;
  r2_key: string;
  format: BookFormat;
}
export interface UserBook {
  id: string;
  user_id: string;
  book_id: string;
  added_at: string;
  last_opened_at: string | null;
  favorite: boolean;
  status: BookStatus;
  updated_at: string;
  deleted_at: string | null;
  display_title: string | null;
  display_author: string | null;
  cover_path: string | null;
  metadata_updated_at: string;
}
export interface CloudUsage {
  used_books: number;
  used_bytes: number;
  max_bytes: number;
  plan?: "free" | "plus" | "pro";
  active_pending_uploads?: number;
  reserved_bytes?: number;
}
export interface CloudStorageBook {
  book_id: string;
  title: string;
  author: string;
  file_size: number;
  cover_path: string | null;
  added_at: string;
}
export interface ReadingProgress {
  user_id: string;
  book_id: string;
  page: number;
  cfi: string | null;
  percentage: number;
  pdf_text_offset: number;
  font_size: number;
  updated_at: string;
}
export interface Note {
  id: string;
  user_id: string;
  book_id: string;
  format: BookFormat;
  page: number | null;
  y: number | null;
  cfi: string | null;
  quote: string;
  content: string;
  color: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banner_url?: string | null;
  bio: string;
  created_at: string;
  updated_at: string;
}
export interface Review {
  id: string;
  user_id: string;
  book_id: string;
  rating: number;
  text: string;
  created_at: string;
  updated_at: string;
}
export interface ReviewLike {
  review_id: string;
  user_id: string;
  created_at: string;
}
export interface ReviewComment {
  id: string;
  review_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}
export interface Follow {
  follower_id: string;
  following_id: string;
  created_at: string;
}
export interface BookList {
  id: string;
  user_id: string;
  title: string;
  description: string;
  visibility: "public" | "private";
  created_at: string;
  updated_at: string;
}
export interface BookListItem {
  list_id: string;
  book_id: string;
  added_at: string;
}
export interface LibraryFolder {
  id: string;
  user_id: string;
  name: string;
  color?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export interface FolderMembership {
  user_id: string;
  book_id: string;
  folder_id: string | null;
  updated_at: string;
}
export interface FeedItem {
  id: string;
  kind: "review" | "list_item";
  user_id: string;
  book_id: string;
  title: string;
  username: string;
  display_name: string;
  created_at: string;
}
type Table<T> = {
  Row: { [K in keyof T]: T[K] };
  Insert: { [K in keyof T]?: T[K] };
  Update: { [K in keyof T]?: T[K] };
  Relationships: [];
};
export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      books: Table<Book>;
      user_books: Table<UserBook>;
      reading_progress: Table<ReadingProgress>;
      notes: Table<Note>;
      reviews: Table<Review>;
      review_likes: Table<ReviewLike>;
      review_comments: Table<ReviewComment>;
      follows: Table<Follow>;
      book_lists: Table<BookList>;
      book_list_items: Table<BookListItem>;
      library_folders: Table<LibraryFolder>;
      library_folder_books: Table<FolderMembership>;
    };
    Views: Record<string, never>;
    Functions: {
      publish_book_review: {
        Args: { p_book_id: string; p_title: string; p_author: string; p_format: string; p_rating: number; p_text: string };
        Returns: { review: Review; book: Book };
      };
      library_quota: {
        Args: Record<string, never>;
        Returns: { used_books: number; used_bytes: number; max_bytes: number; plan: "free" | "plus" | "pro";
          active_pending_uploads?: number; reserved_bytes?: number; recent_unique_uploads?: number;
          expired_reservations?: number; max_pending_uploads?: number };
      };
      plan_catalog: { Args: Record<string, never>; Returns: import("./plans").PlanDefinition[] };
      account_plan: { Args: Record<string, never>; Returns: import("./plans").AccountPlan };
      get_user_entitlements: {
        Args: Record<string, never>;
        Returns: {
          plan: "free" | "plus" | "pro"; cloudStorageBytes: number; maxDevices: number | null;
          sync: boolean; offline: boolean; notesAndHighlights: boolean; advancedThemes: boolean;
          advancedStats: boolean; translationTier: "very_limited" | "standard" | "high";
          premiumTtsTier: "none" | "limited" | "full"; subscriptionStatus: string;
          billingPeriod: "monthly" | "annual" | null; currentPeriodStart: string | null;
          currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
          provider: "lemonsqueezy" | "google_play" | "apple" | "microsoft_store" | "manual" | null;
          activeDevices: number;
        };
      };
      register_device: { Args: { p_device: string; p_platform: string; p_name: string }; Returns: import("./devices").DeviceAccess };
      account_devices: { Args: Record<string, never>; Returns: import("./devices").AccountDevice[] };
      remove_account_device: { Args: { p_device: string }; Returns: { removed: boolean } };
      cloud_storage_books: {
        Args: { p_offset?: number; p_limit?: number; p_sort?: string };
        Returns: CloudStorageBook[];
      };
      cloud_book_identities: {
        Args: Record<string, never>;
        Returns: { book_id: string; file_hash: string; format: "epub" | "pdf"; file_size: number }[];
      };
      sync_changes: {
        Args: { operations: unknown };
        Returns: { id: string; outcome: string }[];
      };
      social_feed: {
        Args: {
          p_before?: string;
          p_cursor?: string;
          p_following?: boolean;
          p_limit?: number;
        };
        Returns: FeedItem[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
