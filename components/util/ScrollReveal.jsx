'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './ScrollReveal.module.css';

/**
 * Wrap children in a div that fades + slides in when it first scrolls into view.
 * Respects `prefers-reduced-motion` - disabled via the global CSS rule.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {number} [props.delay=0] - animation delay in ms
 * @param {string} [props.className]
 * @param {string} [props.as='div']
 */
export default function ScrollReveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`${styles.reveal} ${visible ? styles.visible : ''} ${className ?? ''}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
