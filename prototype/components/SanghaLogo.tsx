import React from 'react';
import logoUrl from '../assets/logo.png';

interface LogoProps {
  className?: string;
}

export const SanghaLogo: React.FC<LogoProps> = ({ className = "w-12 h-12" }) => {
  return (
    <img 
      src={logoUrl} 
      alt="Eau Claire Buddhist Sangha Logo" 
      className={`object-contain ${className}`}
    />
  );
};

export default SanghaLogo;
