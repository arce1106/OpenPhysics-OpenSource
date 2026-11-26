import enum
from datetime import datetime
from sqlalchemy import Integer, Float, Text, Boolean, ForeignKey, Enum, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from .base import Base


class QuestionType(str, enum.Enum):
    single_choice = "single_choice"
    multiple_choice = "multiple_choice"
    true_false = "true_false"
    fill_in_blank = "fill_in_blank"
    knowledge_fill_in_blank = "knowledge_fill_in_blank"
    experiment = "experiment"
    graph_construction = "graph_construction"
    problem_solving = "problem_solving"
    comprehensive = "comprehensive"


class DifficultyTier(str, enum.Enum):
    easy = "easy"
    moderate_easy = "moderate_easy"
    medium = "medium"
    moderate_hard = "moderate_hard"
    hard = "hard"


class QualityStatus(str, enum.Enum):
    draft = "draft"
    pending_review = "pending_review"
    approved = "approved"
    calibrating = "calibrating"
    retired = "retired"


class QuestionSource(str, enum.Enum):
    ai_generated = "ai_generated"
    human = "human"
    curated = "curated"


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    stem_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    question_type: Mapped[QuestionType | None] = mapped_column(Enum(QuestionType))
    difficulty: Mapped[float | None] = mapped_column(Float)
    difficulty_tier: Mapped[DifficultyTier | None] = mapped_column(
        Enum(DifficultyTier), index=True
    )
    irt_difficulty_b: Mapped[float | None] = mapped_column(Float)  # IRT difficulty parameter
    irt_discrimination_a: Mapped[float | None] = mapped_column(Float)  # IRT discrimination parameter
    irt_guessing_c: Mapped[float | None] = mapped_column(Float)  # IRT guessing parameter
    source: Mapped[QuestionSource | None] = mapped_column(Enum(QuestionSource))
    quality_status: Mapped[QualityStatus] = mapped_column(
        Enum(QualityStatus), default=QualityStatus.draft
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    options: Mapped[list["QuestionOption"]] = relationship(
        back_populates="question",
        order_by="QuestionOption.label",
    )
    labels: Mapped[list["QuestionLabel"]] = relationship(back_populates="question")
    formulas: Mapped[list["QuestionFormula"]] = relationship(back_populates="question")
    images: Mapped[list["QuestionImage"]] = relationship(
        back_populates="question",
        order_by="QuestionImage.id",
    )


class QuestionOption(Base):
    __tablename__ = "question_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id"), nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    targets_misconception: Mapped[str | None] = mapped_column(Text)

    question: Mapped["Question"] = relationship(back_populates="options")


class QuestionLabel(Base):
    __tablename__ = "question_labels"
    __table_args__ = (
        Index(
            "ix_question_labels_type_label_question",
            "label_type",
            "label_id",
            "question_id",
        ),
        Index("ix_question_labels_question_id", "question_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id"), nullable=False)
    label_type: Mapped[str] = mapped_column(Text, nullable=False)
    label_id: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, default="主要")
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(Text, default="ai")
    related_kp_id: Mapped[str | None] = mapped_column(Text)

    question: Mapped["Question"] = relationship(back_populates="labels")


class QuestionFormula(Base):
    __tablename__ = "question_formulas"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id"), nullable=False)
    latex: Mapped[str] = mapped_column(Text, nullable=False)
    formula_role: Mapped[str | None] = mapped_column(Text)
    knowledge_point_id: Mapped[str | None] = mapped_column(Text)
    variables: Mapped[dict | None] = mapped_column(JSONB)
    confidence: Mapped[float | None] = mapped_column(Float)

    question: Mapped["Question"] = relationship(back_populates="formulas")


class QuestionImage(Base):
    __tablename__ = "question_images"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id"), nullable=False)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    image_type: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    extracted_structure: Mapped[dict | None] = mapped_column(JSONB)
    related_knowledge_points: Mapped[dict | None] = mapped_column(JSONB)
    confidence: Mapped[float | None] = mapped_column(Float)

    question: Mapped["Question"] = relationship(back_populates="images")
