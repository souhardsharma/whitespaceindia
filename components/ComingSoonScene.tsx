import Link from "next/link";
import styles from "./ComingSoonScene.module.css";

type Vertical = "health" | "energy" | "education";

const SCENE_CLASS: Record<Vertical, string> = {
  health: styles.sceneHealth,
  energy: styles.sceneEnergy,
  education: styles.sceneEducation,
};

export default function ComingSoonScene({
  title,
  vertical,
}: {
  title: string;
  vertical: Vertical;
}) {
  return (
    <main className={styles.root}>
      <div className={`${styles.scene} ${SCENE_CLASS[vertical]}`} />
      <div className={styles.grain} />

      <Link href="/" className={styles.back} aria-label="Back to Whitespace India">
        ← Whitespace India
      </Link>
      <a
        href="https://www.linkedin.com/in/souhardsharma/"
        target="_blank"
        rel="noopener noreferrer"
        className={styles.contact}
      >
        Get in touch
      </a>

      <div className={styles.content}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.subtitle}>Coming Soon</div>
        <p className={styles.blurb}>
          A new Whitespace India research initiative, currently in development.
          The opportunity index for {title.toLowerCase()} arrives later this year.
        </p>
      </div>

      <div className={styles.copyright}>
        © {new Date().getFullYear()} Whitespace India
      </div>
    </main>
  );
}
