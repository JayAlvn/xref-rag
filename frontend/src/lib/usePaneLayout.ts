import { useEffect, useRef, useState } from 'react';
import type { GroupImperativeHandle, Layout } from 'react-resizable-panels';
import { useFold } from './useFold';

// Smallest shares of the window, in percent.
export const LEFT_MIN = 20;
export const CHAT_MIN = 20;

export function usePaneLayout() {
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const contextPanelRef = useRef<HTMLDivElement | null>(null);
  const fold = useFold();

  const [chatVisible, setChatVisible] = useState(true);
  const [contextVisible, setContextVisible] = useState(true);

  // While a pane folds, its content is held at its open width so it slides instead of re-wrapping.
  const [chatPin, setChatPin] = useState<number | null>(null);
  const [contextPin, setContextPin] = useState<number | null>(null);

  // The size each pane last had while open, in percent and in pixels.
  const chatOpenShare = useRef(22);
  const chatOpenWidth = useRef(0);
  const contextOpenShare = useRef(22);
  const contextOpenWidth = useRef(0);

  useEffect(() => {
    const chatEl = chatPanelRef.current;
    if (!chatEl) return;
    const observer = new ResizeObserver(() => {
      const width = chatEl.getBoundingClientRect().width;
      if (!fold.foldingRef.current && width > 0) {
        chatOpenWidth.current = width;
      }
    });
    observer.observe(chatEl);
    return () => observer.disconnect();
  }, []);

  // The chat trades width with the left column only.
  const toggleChat = () => {
    const group = groupRef.current;
    if (!group) return;
    const layout = group.getLayout();
    if (layout.left === undefined) return;

    const left = layout.left;
    const chat = layout.chat ?? 0;
    const opening = chat < 0.5;

    let next: Layout;
    if (opening) {
      const share = Math.max(CHAT_MIN, Math.min(chatOpenShare.current, left - LEFT_MIN));
      next = { ...layout, left: left - share, chat: share };
    } else {
      chatOpenShare.current = chat;
      next = { ...layout, left: left + chat, chat: 0 };
    }

    fold.fold(
      () => group.setLayout(next),
      () => {
        if (chatOpenWidth.current > 0) setChatPin(chatOpenWidth.current);
      },
      () => setChatPin(null),
    );
    setChatVisible(opening);
  };

  // The context pane trades width with the chat while it is open, otherwise with the left column.
  const toggleContext = () => {
    const group = groupRef.current;
    if (!group) return;
    const layout = group.getLayout();
    if (layout.left === undefined) return;

    const left = layout.left;
    const chat = layout.chat ?? 0;
    const context = layout.files ?? 0;
    const opening = context < 0.5;

    let next: Layout;
    if (opening) {
      let fromChat = 0;
      if (chat > 0) {
        fromChat = Math.min(contextOpenShare.current, Math.max(chat - CHAT_MIN, 0));
      }
      const fromLeft = Math.min(contextOpenShare.current - fromChat, Math.max(left - LEFT_MIN, 0));
      next = { ...layout, left: left - fromLeft, chat: chat - fromChat, files: fromChat + fromLeft };
    } else {
      contextOpenShare.current = context;
      const panelEl = contextPanelRef.current;
      if (panelEl) {
        contextOpenWidth.current = panelEl.getBoundingClientRect().width;
      }
      if (chat > 0) {
        next = { ...layout, chat: chat + context, files: 0 };
      } else {
        next = { ...layout, left: left + context, files: 0 };
      }
    }

    fold.fold(
      () => group.setLayout(next),
      () => {
        if (contextOpenWidth.current > 0) setContextPin(contextOpenWidth.current);
      },
      () => setContextPin(null),
    );
    setContextVisible(opening);
  };

  // Dragging a pane below its minimum folds it. Sizes reported mid-fold are ignored.
  const onChatResize = (share: number) => {
    if (!fold.foldingRef.current) setChatVisible(share > 0);
  };

  const onContextResize = (share: number) => {
    if (!fold.foldingRef.current) setContextVisible(share > 0);
  };

  return {
    groupRef,
    chatPanelRef,
    contextPanelRef,
    folding: fold.folding,
    chatVisible,
    contextVisible,
    chatPin,
    contextPin,
    toggleChat,
    toggleContext,
    onChatResize,
    onContextResize,
  };
}
