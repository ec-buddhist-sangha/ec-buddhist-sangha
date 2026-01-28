
import React from 'react';
import { Menu, X, Heart } from 'lucide-react';
import SanghaLogo from './SanghaLogo';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isAdmin: boolean;
  toggleAdmin: () => void;
}

const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, isAdmin, toggleAdmin }) => {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'about', label: 'About' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'forum', label: 'Forum' },
  ];

  const handleNavClick = (id: string) => {
    setActiveTab(id);
    setIsMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header className="bg-sangha-navy text-white sticky top-0 z-50 shadow-lg">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-20">
          <div 
            className="flex items-center gap-3 cursor-pointer group" 
            onClick={() => handleNavClick('home')}
          >
            <div className="relative flex items-center justify-center w-12 h-12 md:w-14 md:h-14">
               <div 
                  className="absolute inset-0 rounded-full group-hover:scale-110 transition-transform duration-300"
                  style={{ 
                    background: 'radial-gradient(closest-side, rgba(255,255,255,0.9) 20%, rgba(255,255,255,0.2) 70%, transparent 100%)',
                    filter: 'blur(4px)'
                  }}
                ></div>
              <SanghaLogo className="w-10 h-10 md:w-12 md:h-12 relative z-10" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-serif text-lg md:text-xl leading-none tracking-wide font-bold">EAU CLAIRE</h1>
              <span className="text-[10px] md:text-xs text-sangha-gold uppercase tracking-widest">Buddhist Sangha</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 lg:gap-8">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`${activeTab === item.id ? 'text-sangha-gold border-b-2 border-sangha-gold' : 'text-gray-300 hover:text-white'} transition-all text-xs font-bold tracking-widest uppercase py-2`}
              >
                {item.label}
              </button>
            ))}
            
            <button className="bg-sangha-gold hover:bg-yellow-600 text-sangha-navy px-5 py-2 rounded-full font-bold transition-all flex items-center gap-2 shadow-md transform hover:-translate-y-0.5 active:translate-y-0">
              <Heart size={14} className="fill-current" />
              <span className="text-xs uppercase tracking-tighter">Donate</span>
            </button>

            <button 
               onClick={() => handleNavClick('admin')}
               className={`text-[10px] uppercase tracking-tighter border border-white/20 px-3 py-1 rounded-full hover:bg-white/10 transition-colors ${activeTab === 'admin' ? 'bg-white/20 border-white/40' : 'text-white/40'}`}
            >
              CMS
            </button>
          </nav>

          <div className="md:hidden flex items-center">
             <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-white p-2">
               {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
             </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden bg-sangha-navy border-t border-white/10 py-6 px-6 flex flex-col gap-4 animate-in slide-in-from-top duration-300">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`text-left text-lg font-serif py-3 border-b border-white/5 ${activeTab === item.id ? 'text-sangha-gold' : 'text-white'}`}
            >
              {item.label}
            </button>
          ))}
          <button 
            onClick={() => handleNavClick('admin')}
            className="text-left text-gray-500 text-sm py-2"
          >
            Admin Panel
          </button>
          <button className="bg-sangha-gold text-sangha-navy w-full py-4 rounded-xl font-bold mt-4 shadow-lg">
            Support the Sangha
          </button>
        </div>
      )}
    </header>
  );
};

export default Header;
