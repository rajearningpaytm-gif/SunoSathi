import { useState } from "react";
import { useLocation } from "wouter";
import { useApplyAsListener, useGetMyProfile } from "@workspace/api-client-react";
import { PageTransition } from "@/components/PageTransition";
import { GradientButton } from "@/components/GradientButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ListenerApplicationBodyGender } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

const SKILL_PRESETS = [
  "Empathy", "Career", "Relationships", "Anxiety",
  "Loneliness", "Motivation", "Breakup", "Stress", "Sadness"
];

// 4 female + 4 male high-quality Unsplash avatars
const FEMALE_AVATARS = [
  {
    url: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400&q=80",
    label: "Priya",
  },
  {
    url: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&q=80",
    label: "Ananya",
  },
  {
    url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80",
    label: "Myra",
  },
  {
    url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80",
    label: "Zara",
  },
];

const MALE_AVATARS = [
  {
    url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80",
    label: "Aryan",
  },
  {
    url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80",
    label: "Kabir",
  },
  {
    url: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80",
    label: "Rohan",
  },
  {
    url: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&q=80",
    label: "Vihaan",
  },
];

const ALL_AVATARS = [...FEMALE_AVATARS, ...MALE_AVATARS];

export default function Apply() {
  const [, setLocation] = useLocation();
  const { data: profile } = useGetMyProfile();
  const applyMutation = useApplyAsListener();

  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState<ListenerApplicationBodyGender>("other");
  const [bio, setBio] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(ALL_AVATARS[0].url);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  if (profile?.listenerProfile) {
    if (
      profile.listenerProfile.applicationStatus === "approved" ||
      profile.listenerProfile.applicationStatus === "pending"
    ) {
      setLocation("/home");
      return null;
    }
  }

  const toggleSkill = (skill: string) => {
    if (selectedSkills.includes(skill)) {
      setSelectedSkills((s) => s.filter((x) => x !== skill));
    } else {
      if (selectedSkills.length >= 5) {
        toast.error("Maximum 5 skills allowed");
        return;
      }
      setSelectedSkills((s) => [...s, skill]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName.length < 2) {
      toast.error("Display name must be at least 2 characters");
      return;
    }
    if (bio.length < 20) {
      toast.error("Bio must be at least 20 characters");
      return;
    }
    if (selectedSkills.length === 0) {
      toast.error("Select at least one skill");
      return;
    }

    applyMutation.mutate(
      { data: { displayName, gender, bio, skills: selectedSkills, photoUrl: selectedAvatar } },
      {
        onSuccess: () => {
          toast.success("Application submitted! We'll review it soon. 👂");
          setLocation("/home");
        },
        onError: () => toast.error("Failed to submit application"),
      }
    );
  };

  return (
    <PageTransition className="flex-1 flex flex-col p-4 pb-32">
      <h1 className="text-2xl font-bold mb-1 px-2">Become a Listener</h1>
      <p className="text-muted-foreground px-2 mb-6 text-sm">Complete your profile to start helping others.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="glass-card p-5 rounded-[2rem] space-y-5">

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How should users call you?"
              className="rounded-xl bg-background/50 border-border/50"
              maxLength={40}
            />
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label>Gender</Label>
            <Select value={gender} onValueChange={(v: any) => setGender(v)}>
              <SelectTrigger className="rounded-xl bg-background/50 border-border/50">
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label htmlFor="bio">About You</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell users why you are a great listener..."
              className="rounded-xl bg-background/50 border-border/50 resize-none h-24"
              maxLength={600}
            />
            <p className="text-xs text-muted-foreground text-right">{bio.length}/600 (min 20)</p>
          </div>

          {/* Skills */}
          <div className="space-y-2">
            <Label>Skills & Expertise <span className="text-muted-foreground text-xs">(max 5)</span></Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {SKILL_PRESETS.map((skill) => {
                const isSelected = selectedSkills.includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-foreground border-border/50 hover:border-primary/40"
                    )}
                  >
                    {skill}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Avatar Selection */}
          <div className="space-y-3">
            <Label>Select Your Avatar</Label>
            <div className="grid grid-cols-4 gap-3">
              {ALL_AVATARS.map((avatar) => {
                const isSelected = selectedAvatar === avatar.url;
                return (
                  <button
                    key={avatar.url}
                    type="button"
                    onClick={() => setSelectedAvatar(avatar.url)}
                    className={cn(
                      "relative rounded-2xl overflow-hidden aspect-square transition-all border-2",
                      isSelected
                        ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background scale-105"
                        : "border-transparent hover:border-primary/30 hover:scale-102 opacity-75 hover:opacity-100"
                    )}
                  >
                    <img
                      src={avatar.url}
                      alt={avatar.label}
                      className="w-full h-full object-cover"
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-end justify-center pb-1">
                        <CheckCircle2 className="w-5 h-5 text-white drop-shadow" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground pl-1">
              Top row: Female avatars · Bottom row: Male avatars
            </p>
          </div>

          {/* Selected Avatar Preview */}
          <div className="flex items-center gap-4 pt-1">
            <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-primary/30 shrink-0">
              <img src={selectedAvatar} alt="Selected" className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {ALL_AVATARS.find((a) => a.url === selectedAvatar)?.label ?? "Your avatar"}
              </p>
              <p className="text-xs text-muted-foreground">This is how you'll appear to users</p>
            </div>
          </div>
        </div>

        <GradientButton
          type="submit"
          className="w-full py-6 text-lg rounded-2xl"
          isLoading={applyMutation.isPending}
        >
          Submit Application
        </GradientButton>
      </form>
    </PageTransition>
  );
}
