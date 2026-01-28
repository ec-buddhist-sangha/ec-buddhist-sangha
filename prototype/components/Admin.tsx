import React, { useState } from 'react';
import { PostType } from '../types';
import { Save, LayoutDashboard, FileText, Calendar } from 'lucide-react';

interface AdminProps {
  onAddPost: (title: string, content: string, type: PostType) => void;
}

const Admin: React.FC<AdminProps> = ({ onAddPost }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<PostType>(PostType.EVENT);
  const [notification, setNotification] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddPost(title, content, type);
    setTitle('');
    setContent('');
    setNotification('Post published successfully!');
    setTimeout(() => setNotification(null), 3000);
  };

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-sangha-navy text-white hidden md:flex flex-col p-6">
        <h2 className="text-xl font-bold mb-8 flex items-center gap-2">
          <LayoutDashboard /> CMS
        </h2>
        <div className="space-y-2">
          <button className="w-full text-left px-4 py-2 bg-sangha-gold text-sangha-navy rounded font-bold">
             Create Content
          </button>
          <button className="w-full text-left px-4 py-2 text-gray-300 hover:bg-white/10 rounded">
             Manage Events
          </button>
          <button className="w-full text-left px-4 py-2 text-gray-300 hover:bg-white/10 rounded">
             Users
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-800 mb-6">Create New Post</h1>
          
          {notification && (
            <div className="bg-green-100 border border-green-300 text-green-800 px-4 py-3 rounded mb-6">
              {notification}
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-700 mb-2">Post Type</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer p-3 border rounded-lg hover:bg-gray-50 has-[:checked]:border-sangha-gold has-[:checked]:bg-yellow-50">
                  <input 
                    type="radio" 
                    name="type" 
                    className="text-sangha-gold focus:ring-sangha-gold"
                    checked={type === PostType.EVENT}
                    onChange={() => setType(PostType.EVENT)}
                  />
                  <Calendar size={16} />
                  <span className="text-sm font-medium">Event</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer p-3 border rounded-lg hover:bg-gray-50 has-[:checked]:border-sangha-gold has-[:checked]:bg-yellow-50">
                  <input 
                    type="radio" 
                    name="type" 
                    className="text-sangha-gold focus:ring-sangha-gold"
                    checked={type === PostType.ANNOUNCEMENT}
                    onChange={() => setType(PostType.ANNOUNCEMENT)}
                  />
                  <FileText size={16} />
                  <span className="text-sm font-medium">Announcement</span>
                </label>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-700 mb-2">Title</label>
              <input 
                type="text" 
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border-gray-300 rounded-lg focus:ring-sangha-gold focus:border-sangha-gold p-3 border"
                placeholder="e.g., Spring Picnic Details"
              />
            </div>

            <div className="mb-8">
              <label className="block text-sm font-bold text-gray-700 mb-2">Content</label>
              <textarea 
                required
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full border-gray-300 rounded-lg focus:ring-sangha-gold focus:border-sangha-gold p-3 border"
                placeholder="Write the body of your post here..."
              />
            </div>

            <div className="flex items-center justify-end gap-4">
              <button type="button" className="px-6 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button type="submit" className="bg-sangha-navy text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-900 transition-colors shadow-lg">
                <Save size={18} />
                Publish to Feed
              </button>
            </div>
          </form>
          
          <div className="mt-8 text-center text-sm text-gray-500">
            This interface simulates the Decap CMS experience for creating content.
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;