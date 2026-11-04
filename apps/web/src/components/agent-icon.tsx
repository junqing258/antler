import {
  Bot, Sparkles, Brain, Search, BookOpen, GraduationCap, Code, Terminal,
  ChartNoAxesCombined, BriefcaseBusiness, Calculator, PenTool, Languages,
  Palette, Music, Camera, Globe, Compass, Heart, Shield, FlaskConical,
  Wrench, Calendar, Mail,
} from "lucide-react";

// Explicit imports keep the rest of the Lucide catalog out of the app bundle.
const icons = {
  Bot, Sparkles, Brain, Search, BookOpen, GraduationCap, Code, Terminal,
  ChartNoAxesCombined, BriefcaseBusiness, Calculator, PenTool, Languages,
  Palette, Music, Camera, Globe, Compass, Heart, Shield, FlaskConical,
  Wrench, Calendar, Mail,
};

export function AgentIcon({ name, className = "size-6" }: { name?: string | null; className?: string }) {
  const Icon = name && Object.hasOwn(icons, name) ? icons[name as keyof typeof icons] : Bot;
  return <Icon aria-hidden="true" className={className} />;
}
