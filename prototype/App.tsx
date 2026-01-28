
import React, { useState } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import Feed from './components/Feed';
import Forum from './components/Forum';
import Admin from './components/Admin';
import AISanghaAssistant from './components/AISanghaAssistant';
import { INITIAL_POSTS, INITIAL_TOPICS, MOCK_USER, SANGHA_INFO } from './constants';
import { Post, PostType, Comment } from './types';
import { Calendar as CalendarIcon, Info, Users, Leaf } from 'lucide-react';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('home');
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [isAdmin, setIsAdmin] = useState(false);

  const handleAddPost = (title: string, content: string, type: PostType) => {
    const newPost: Post = {
      id: Date.now().toString(),
      title,
      content,
      type,
      author: MOCK_USER.name,
      createdAt: new Date().toISOString(),
      likes: 0,
      comments: [],
      date: type === PostType.EVENT ? new Date(Date.now() + 86400000 * 3).toISOString() : undefined,
      location: type === PostType.EVENT ? 'Unity of Eau Claire' : undefined
    };
    setPosts([newPost, ...posts]);
    setActiveTab('home');
  };

  const handleAddComment = (postId: string, content: string) => {
    const newComment: Comment = {
      id: Date.now().toString(),
      author: 'Guest',
      content,
      createdAt: new Date().toISOString()
    };
    setPosts(posts.map(p => p.id === postId ? { ...p, comments: [...p.comments, newComment] } : p));
  };

  const renderHomeLanding = () => (
    <>
      <Hero />
      
      {/* Our Practice Quick Intro */}
      <section className="bg-white py-16 border-b border-gray-100">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid md:grid-cols-3 gap-12 text-center">
            {SANGHA_INFO.practice.map((item, idx) => (
              <div key={idx} className="flex flex-col items-center">
                <div className="w-16 h-16 bg-sangha-light text-sangha-gold rounded-full flex items-center justify-center mb-4">
                  {idx === 0 ? <Leaf size={32} /> : idx === 1 ? <Info size={32} /> : <Users size={32} />}
                </div>
                <h3 className="font-serif text-xl font-bold text-sangha-navy mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Newcomer Guide Callout */}
      <section className="bg-sangha-light py-12">
        <div className="container mx-auto px-4">
          <div className="bg-sangha-navy rounded-3xl p-8 md:p-12 text-white flex flex-col md:flex-row items-center justify-between gap-8 max-w-6xl mx-auto shadow-xl">
            <div className="flex-1">
              <h2 className="text-3xl font-serif font-bold mb-4">New to Meditation?</h2>
              <p className="text-blue-100 mb-6 max-w-lg">
                We offer free meditation instruction every Tuesday at 6:45 PM. No special clothing or equipment needed. Cushions and chairs are provided.
              </p>
              <button 
                onClick={() => setActiveTab('about')}
                className="bg-white text-sangha-navy px-8 py-3 rounded-full font-bold hover:bg-blue-50 transition-colors"
              >
                Read Newcomer Guide
              </button>
            </div>
            <div className="w-full md:w-auto flex justify-center">
              <Leaf size={120} className="text-sangha-gold opacity-20" />
            </div>
          </div>
        </div>
      </section>

      {/* Community Feed */}
      <div className="bg-sangha-paper min-h-screen pb-20">
         <Feed posts={posts} onAddComment={handleAddComment} />
      </div>
    </>
  );

  const renderAbout = () => (
    <div className="bg-sangha-light min-h-screen py-16">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="font-serif text-4xl font-bold text-sangha-navy mb-8">About the Sangha</h1>
        <div className="bg-white rounded-2xl p-8 md:p-12 shadow-sm prose prose-slate max-w-none">
          <p className="text-lg text-gray-700 leading-relaxed mb-6">
            The <strong>Eau Claire Buddhist Sangha</strong> is a non-sectarian group of individuals dedicated to the practice of mindfulness and the study of the Buddha's teachings.
          </p>
          <h2 className="text-2xl font-serif text-sangha-navy mt-8 mb-4">Our History</h2>
          <p className="text-gray-600 mb-6">
            Founded in the early 2000s, our community has met weekly for over two decades. We aim to offer a quiet refuge for practitioners in the Chippewa Valley to gather and sit in silence.
          </p>
          <div className="bg-sangha-light p-6 rounded-xl border-l-4 border-sangha-gold my-8">
            <h3 className="font-bold text-sangha-navy mb-2">Dana: The Practice of Generosity</h3>
            <p className="text-sm text-gray-600">
              There is no charge for our meetings or instruction. We operate entirely on Dana (donations), which help cover our space rental and group expenses.
            </p>
          </div>
          <h2 className="text-2xl font-serif text-sangha-navy mt-8 mb-4">What to Expect</h2>
          <ul className="space-y-4 text-gray-600">
            <li><strong>6:45 PM:</strong> Optional meditation instruction for beginners.</li>
            <li><strong>7:00 PM:</strong> Period of silent sitting meditation (30 minutes).</li>
            <li><strong>7:30 PM:</strong> Reading, Dharma talk, or presentation.</li>
            <li><strong>8:00 PM:</strong> Tea and open discussion.</li>
          </ul>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'home': return renderHomeLanding();
      case 'about': return renderAbout();
      case 'forum': return <div className="bg-sangha-light min-h-screen pt-8 pb-20"><Forum topics={INITIAL_TOPICS} /></div>;
      case 'admin': return <Admin onAddPost={handleAddPost} />;
      case 'calendar': return (
        <div className="min-h-screen bg-sangha-light flex flex-col items-center justify-center p-8 text-center">
           <div className="bg-white p-12 rounded-3xl shadow-lg max-w-2xl">
             <CalendarIcon size={64} className="text-sangha-gold mx-auto mb-6" />
             <h2 className="text-3xl font-serif text-sangha-navy font-bold mb-4">Sangha Calendar</h2>
             <p className="text-gray-600 mb-8 leading-relaxed">View our schedule for upcoming Tuesday sits, seasonal retreats, and community service events.</p>
             <a href="https://calendar.google.com" target="_blank" rel="noreferrer" className="inline-block bg-sangha-navy text-white px-8 py-3 rounded-full font-bold hover:bg-blue-900 transition-all shadow-md">
               Open Google Calendar
             </a>
           </div>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-sangha-gold/30">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} isAdmin={isAdmin} toggleAdmin={() => setIsAdmin(!isAdmin)} />
      <main className="flex-1">{renderContent()}</main>
      <AISanghaAssistant />
      {activeTab !== 'admin' && (
        <footer className="bg-sangha-navy text-white py-16">
          <div className="container mx-auto px-4">
             <div className="grid md:grid-cols-4 gap-12">
                <div className="col-span-1 md:col-span-2">
                   <h3 className="font-serif font-bold text-2xl mb-4 text-sangha-gold">Eau Claire Buddhist Sangha</h3>
                   <p className="text-blue-200 text-sm leading-relaxed max-w-md">
                     An ecumenical community dedicated to mindfulness and Buddhist practice in Western Wisconsin. All are welcome regardless of religious background or experience level.
                   </p>
                </div>
                <div>
                   <h4 className="font-bold mb-4 uppercase tracking-widest text-[10px] text-white/40">Location</h4>
                   <p className="text-blue-100 text-sm">Unity of Eau Claire</p>
                   <p className="text-blue-100 text-sm">1808 Folsom Street</p>
                   <p className="text-blue-100 text-sm">Eau Claire, WI 54703</p>
                </div>
                <div>
                   <h4 className="font-bold mb-4 uppercase tracking-widest text-[10px] text-white/40">Links</h4>
                   <ul className="space-y-2">
                     <li><a href="#" className="text-blue-200 hover:text-sangha-gold text-sm transition-colors">Facebook Community</a></li>
                     <li><a href="#" className="text-blue-200 hover:text-sangha-gold text-sm transition-colors">Email Newsletter</a></li>
                     <li><button onClick={() => setActiveTab('admin')} className="text-blue-200/50 hover:text-white text-[10px] uppercase">Admin CMS</button></li>
                   </ul>
                </div>
             </div>
             <div className="mt-16 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] text-blue-400 uppercase tracking-widest">
               <span>© {new Date().getFullYear()} EC Buddhist Sangha</span>
               <span>Built for Clarity and Compassion</span>
             </div>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
