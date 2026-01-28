import React from 'react';
import { ForumTopic } from '../types';
import { MessageSquare, Clock, Hash, ChevronRight, PlusCircle } from 'lucide-react';

interface ForumProps {
  topics: ForumTopic[];
}

const Forum: React.FC<ForumProps> = ({ topics }) => {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-serif text-3xl text-sangha-navy font-bold">Community Forum</h2>
          <p className="text-gray-500 mt-1">Discuss practice, books, and life.</p>
        </div>
        <button className="bg-sangha-navy text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-900 transition-colors shadow-md">
          <PlusCircle size={18} />
          <span>New Topic</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-1 divide-y divide-gray-100">
          {topics.map((topic) => (
            <div key={topic.id} className="p-6 hover:bg-gray-50 transition-colors cursor-pointer group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {topic.tags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 text-xs font-medium text-sangha-gold bg-yellow-50 px-2 py-1 rounded-md border border-yellow-100">
                        <Hash size={10} /> {tag}
                      </span>
                    ))}
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 group-hover:text-sangha-navy transition-colors mb-1">
                    {topic.title}
                  </h3>
                  <p className="text-gray-600 text-sm line-clamp-2 mb-3">
                    {topic.excerpt}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span className="font-medium text-gray-600">By {topic.author}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      Last active {topic.lastActive}
                    </span>
                  </div>
                </div>

                <div className="hidden sm:flex flex-col items-end gap-4">
                   <div className="flex items-center gap-1 text-gray-400">
                     <MessageSquare size={16} />
                     <span className="font-medium">{topic.replyCount}</span>
                   </div>
                   <ChevronRight className="text-gray-300 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="mt-8 bg-blue-50 border border-blue-100 p-6 rounded-xl text-center">
         <h4 className="text-sangha-navy font-bold mb-2">Welcome to our Digital Sangha</h4>
         <p className="text-sm text-gray-600 max-w-md mx-auto">
           This space is for mindful discussion. Please adhere to Right Speech in all interactions.
         </p>
      </div>
    </div>
  );
};

export default Forum;