export interface ThemeColors {
  bg: string;
  panelBg: string;
  cardBg: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentText: string;
  fontWeight: number;
}

export const THEMES: { name: string; colors: ThemeColors }[] = [
  {
    name: 'Midnight Dark',
    colors: {
      bg: '#0A0A0A',        // app background — the gutter between panels
      panelBg: '#111111',   // panels
      cardBg: '#1C1C1C',    // cards, chat bubbles, meter tracks
      text: '#EDEDED',
      textMuted: '#8C8C8C',
      border: '#2A2A2A',
      accent: '#3B82F6',
      accentText: '#FFFFFF',
      fontWeight: 400
    }
  },
  {
    name: 'Daylight',
    colors: {
      bg: '#E4E4E1',
      panelBg: '#F2F2F2',
      cardBg: '#E9E9E6',
      text: '#2C2C29',
      textMuted: '#5E5E59',
      border: '#BDBDB7',    // lighter than the accent, so bar tracks stay visible under a filled bar
      accent: '#2C2C29',
      accentText: '#FFFFFF',
      fontWeight: 500       // charcoal on off-white reads thin at regular weight
    }
  }
];
