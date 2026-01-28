
import { Post, PostType, ForumTopic, User, UserRole } from './types';

export const MOCK_USER: User = {
  id: 'u1',
  name: 'Sangha Admin',
  role: UserRole.ADMIN,
};

export const SANGHA_INFO = {
  name: "Eau Claire Buddhist Sangha",
  mission: "To provide a supportive community for the practice of meditation and the study of Buddhist teachings.",
  practice: [
    { title: "Meditation", description: "We practice silent sitting meditation (Vipassana) for 30 minutes." },
    { title: "Dharma", description: "Talks exploring the Buddha's teachings and their application in modern life." },
    { title: "Sangha", description: "Building community through shared presence and mindful discussion." }
  ]
};

export const INITIAL_POSTS: Post[] = [
  {
    id: 'p1',
    type: PostType.EVENT,
    title: 'Weekly Tuesday Sit & Dharma Talk',
    content: 'Our core weekly gathering. We begin with 30 minutes of silent meditation, followed by a talk. This week we explore "The Second Noble Truth: The Cause of Suffering". All levels of experience are welcome.',
    author: 'Board',
    date: '2025-11-25T19:00:00',
    location: 'Unity of Eau Claire',
    createdAt: '2023-11-20T10:00:00',
    likes: 15,
    comments: [
      { id: 'c1', author: 'Mark', content: 'Will this be recorded?', createdAt: '2025-11-21T09:00:00' }
    ]
  },
  {
    id: 'p2',
    type: PostType.ANNOUNCEMENT,
    title: 'New Library Books Available',
    content: 'We have added five new titles to our community library, including Pema Chödrön\'s latest work. Feel free to browse and borrow after our Tuesday meetings.',
    author: 'Librarian',
    createdAt: '2025-11-19T14:00:00',
    likes: 10,
    comments: []
  }
];

export const INITIAL_TOPICS: ForumTopic[] = [
  {
    id: 't1',
    title: 'Daily Practice Struggles',
    excerpt: 'How do you all maintain a 20-minute daily sit when the kids are home?',
    author: 'Sarah J.',
    replyCount: 8,
    lastActive: '1 hour ago',
    tags: ['Daily Life', 'Practice']
  }
];

export const GOOGLE_CLASSROOM_URL = "https://classroom.google.com"; 
export const GOOGLE_CALENDAR_URL = "https://calendar.google.com";
export const DONATION_URL = "#donate";
