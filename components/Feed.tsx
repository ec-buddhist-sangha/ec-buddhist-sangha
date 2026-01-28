import React, { useState } from 'react';
import { Post, PostType } from '../types';
import { Calendar, MessageCircle, User as UserIcon, ThumbsUp, Share2 } from 'lucide-react';

interface FeedProps {
  posts: Post[];
  onAddComment: (postId: string, content: string) => void;
}

const Feed: React.FC<FeedProps> = ({ posts, onAddComment }) => {
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  const handleInputChange = (postId: string, val: string) => {
    setCommentInputs(prev => ({ ...prev, [postId]: val }));
  };

  const handleSubmitComment = (postId: string) => {
    if (commentInputs[postId]?.trim()) {
      onAddComment(postId, commentInputs[postId]);
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-12 px-4">
      <h2 className="font-serif text-3xl text-sangha-navy font-bold mb-8 border-b pb-4 border-gray-200">
        Community Updates
      </h2>

      <div className="space-y-8">
        {posts.map((post) => (
          <article key={post.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                    <UserIcon size={20} />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900">{post.author}</div>
                    <div className="text-xs text-gray-500">{new Date(post.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide 
                  ${post.type === PostType.EVENT ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                  {post.type}
                </span>
              </div>

              <h3 className="text-2xl font-serif font-bold text-sangha-navy mb-3">
                {post.title}
              </h3>

              {post.type === PostType.EVENT && post.date && (
                <div className="flex items-center gap-2 text-sangha-gold font-medium mb-4 bg-sangha-light p-3 rounded-lg">
                  <Calendar size={18} />
                  <span>
                    {new Date(post.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {post.location && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-600 text-sm">{post.location}</span>
                    </>
                  )}
                </div>
              )}

              <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">
                {post.content}
              </p>
            </div>

            {/* Actions Bar */}
            <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 flex items-center justify-between">
              <div className="flex gap-4">
                <button className="flex items-center gap-1 text-gray-500 hover:text-sangha-navy text-sm font-medium transition-colors">
                  <ThumbsUp size={16} />
                  <span>{post.likes} Likes</span>
                </button>
                <button className="flex items-center gap-1 text-gray-500 hover:text-sangha-navy text-sm font-medium transition-colors">
                  <MessageCircle size={16} />
                  <span>{post.comments.length} Comments</span>
                </button>
              </div>
              <button className="text-gray-400 hover:text-gray-600">
                <Share2 size={16} />
              </button>
            </div>

            {/* Comments Section */}
            {post.comments.length > 0 && (
              <div className="bg-gray-50/50 px-6 pb-6 pt-2 space-y-4 border-t border-gray-100">
                {post.comments.map(comment => (
                  <div key={comment.id} className="flex gap-3 text-sm">
                     <div className="font-bold text-gray-800 shrink-0">{comment.author}</div>
                     <div className="text-gray-600">{comment.content}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Comment */}
            <div className="p-4 border-t border-gray-100 flex gap-2">
              <input 
                type="text"
                placeholder="Write a reply..."
                className="flex-1 bg-gray-100 border-transparent focus:bg-white focus:border-sangha-gold focus:ring-0 rounded-full px-4 py-2 text-sm transition-all"
                value={commentInputs[post.id] || ''}
                onChange={(e) => handleInputChange(post.id, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment(post.id)}
              />
              <button 
                onClick={() => handleSubmitComment(post.id)}
                className="text-sangha-navy font-bold text-sm px-3 hover:underline disabled:opacity-50"
                disabled={!commentInputs[post.id]}
              >
                Post
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default Feed;