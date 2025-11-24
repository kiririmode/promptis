import React, { useState } from 'react';

interface ComponentProps {
  title: string;
  onSubmit: (value: string) => void;
}

export const Component: React.FC<ComponentProps> = ({ title, onSubmit }) => {
  const [inputValue, setInputValue] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      await onSubmit(inputValue);
      setInputValue('');
    }
  };

  return (
    <div>
      <h2>{title}</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter text"
        />
        <button type="submit">Submit</button>
      </form>
    </div>
  );
};
