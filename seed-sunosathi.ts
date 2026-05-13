import { db, usersTable, profilesTable, listenersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

type SeedListener = {
  displayName: string;
  gender: "male" | "female" | "other";
  bio: string;
  skills: string[];
  photoUrl: string;
  ratingX100: number;
  ratingCount: number;
  isOnline: boolean;
};

const SEED: SeedListener[] = [
  {
    displayName: "Aarya",
    gender: "female",
    bio: "I've been a peer counsellor for four years. I'm gentle, patient, and I'll never rush you. Tell me what's heavy.",
    skills: ["Empathy", "Loneliness", "Sadness", "Anxiety"],
    photoUrl:
      "https://images.pexels.com/photos/762020/pexels-photo-762020.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 489,
    ratingCount: 128,
    isOnline: true,
  },
  {
    displayName: "Rohan",
    gender: "male",
    bio: "Hostel days were tough for me too. If you're stressed about studies, family or just life — I'm here to listen first, fix later.",
    skills: ["Stress", "Career", "Motivation"],
    photoUrl:
      "https://images.pexels.com/photos/1300402/pexels-photo-1300402.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 472,
    ratingCount: 96,
    isOnline: true,
  },
  {
    displayName: "Maya",
    gender: "female",
    bio: "Heartbreak makes the world quiet in a strange way. I'll sit with you in that quiet for as long as you need.",
    skills: ["Breakup", "Sadness", "Empathy", "Relationships"],
    photoUrl:
      "https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 495,
    ratingCount: 211,
    isOnline: true,
  },
  {
    displayName: "Kabir",
    gender: "male",
    bio: "Engineer turned listener. Calm voice, no judgement. We can talk about anything — from boss problems to existential dread.",
    skills: ["Anxiety", "Career", "Stress"],
    photoUrl:
      "https://images.pexels.com/photos/2381069/pexels-photo-2381069.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 461,
    ratingCount: 73,
    isOnline: false,
  },
  {
    displayName: "Ishita",
    gender: "female",
    bio: "Tea, blanket, and a kind ear — that's my whole offer. Loneliness gets smaller when shared.",
    skills: ["Loneliness", "Sadness", "Empathy"],
    photoUrl:
      "https://images.pexels.com/photos/2787341/pexels-photo-2787341.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 480,
    ratingCount: 152,
    isOnline: true,
  },
  {
    displayName: "Devansh",
    gender: "male",
    bio: "I help people find one tiny next step when everything feels like too much. We'll go slow.",
    skills: ["Motivation", "Stress", "Anxiety"],
    photoUrl:
      "https://images.pexels.com/photos/1416736/pexels-photo-1416736.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 455,
    ratingCount: 64,
    isOnline: true,
  },
  {
    displayName: "Saanvi",
    gender: "female",
    bio: "Trained in active listening. Whatever you say to me stays between us. You're allowed to feel everything.",
    skills: ["Empathy", "Anxiety", "Loneliness", "Sadness"],
    photoUrl:
      "https://images.pexels.com/photos/4172859/pexels-photo-4172859.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 492,
    ratingCount: 188,
    isOnline: false,
  },
  {
    displayName: "Vivaan",
    gender: "male",
    bio: "Late-night listener. If insomnia and overthinking are your usual companions, ping me. I'm probably awake too.",
    skills: ["Loneliness", "Anxiety", "Stress"],
    photoUrl:
      "https://images.pexels.com/photos/874158/pexels-photo-874158.jpeg?auto=compress&cs=tinysrgb&w=600",
    ratingX100: 470,
    ratingCount: 88,
    isOnline: true,
  },
];

async function main() {
  const existing = await db.select().from(listenersTable);
  if (existing.length > 0) {
    console.log(`Listeners already seeded (${existing.length}). Skipping.`);
    return;
  }

  for (let i = 0; i < SEED.length; i++) {
    const l = SEED[i]!;
    const [user] = await db
      .insert(usersTable)
      .values({
        firstName: l.displayName,
        lastName: "(Listener)",
      })
      .returning();
    if (!user) continue;
    const username = `${l.displayName}${100 + i}`;
    await db.insert(profilesTable).values({
      userId: user.id,
      anonymousUsername: username,
      role: "listener",
      isAdmin: false,
      avatarSeed: "moon",
      theme: "light",
      hasOnboarded: true,
      walletBalanceInRupees: 0,
    });
    await db.insert(listenersTable).values({
      id: `lst_seed_${i + 1}`,
      userId: user.id,
      displayName: l.displayName,
      gender: l.gender,
      bio: l.bio,
      skills: l.skills,
      photoUrl: l.photoUrl,
      applicationStatus: "approved",
      isOnline: l.isOnline,
      lastSeenAt: new Date(),
      pricePerMinuteChat: 4,
      pricePerMinuteCall: 7,
      ratingAverage: l.ratingX100,
      ratingCount: l.ratingCount,
      decidedAt: new Date(),
    });
    console.log(`Seeded ${l.displayName}`);
  }
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
