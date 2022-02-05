import mongoose from 'mongoose';

const quizSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Quiz title required"],
    },
    description: {
      type: String,
      default: 'No Description',
    },
    tags: [
        {
            type: String,
            required: [true, "Tags are required"],
        }
      ],
    status: {
      type: String,
      default: 'draft',
      enum: ['draft', 'unpublished', 'active', 'inactive'],
    },
    author: {
      type: String,
      required: [true, 'A quiz needs an author.']
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
  }
);

quizSchema.virtual('questions', {
    ref: 'Question',
    foreignField: 'quiz',
    localField: '_id',
  });

export const Quiz =  mongoose.models.Quiz || mongoose.model('Quiz', quizSchema);
