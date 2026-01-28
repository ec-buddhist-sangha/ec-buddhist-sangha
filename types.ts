export enum PostType {
  EVENT = 'EVENT',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  DHARMA_TALK = 'DHARMA_TALK'
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface Post {
  id: string;
  type: PostType;
  title: string;
  content: string;
  author: string;
  date?: string; // For events
  location?: string;
  createdAt: string;
  comments: Comment[];
  likes: number;
}

export interface ForumTopic {
  id: string;
  title: string;
  excerpt: string;
  author: string;
  replyCount: number;
  lastActive: string;
  tags: string[];
}

export enum UserRole {
  GUEST = 'GUEST',
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN'
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  avatar?: string;
}